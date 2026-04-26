use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use emergent_protocol::{
    AgentStatus, ConfigOption, ConfigUpdatePayload, Notification, StatusChangePayload,
    ThreadErrorPayload, ThreadSummary, WorkspaceId,
};
use tokio::sync::{broadcast, oneshot, Mutex, RwLock};

use super::lifecycle::SessionInit;
use super::usage_store::{
    apply_cost_delta, apply_turn_delta, PersistedWorkspaceState, TurnDelta, WorkspaceUsageStore,
};
use super::{lifecycle, AgentCommand, ThreadHandle};

/// Persisted thread-to-session mapping (stored in threads.json).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ThreadMapping {
    pub thread_id: String,
    pub agent_definition_id: String,
    pub acp_session_id: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
}

pub struct ThreadManager {
    pub(crate) threads: Arc<RwLock<HashMap<String, Arc<Mutex<ThreadHandle>>>>>,
    pub(crate) dormant_threads:
        Arc<RwLock<HashMap<WorkspaceId, HashMap<String, ThreadMapping>>>>,
    pub(crate) event_tx: broadcast::Sender<Notification>,
    pub(crate) history: Arc<RwLock<HashMap<String, Vec<Notification>>>>,
    pub(crate) token_registry: Arc<crate::mcp::TokenRegistry>,
    pub(crate) mcp_port: std::sync::atomic::AtomicU16,
    pub(crate) workspace_state: crate::workspace::SharedWorkspaceState,
    pub(crate) runtime: crate::runtime::SharedRuntime,
    /// Per-workspace aggregated usage totals + recent turn ring buffer.
    pub(crate) usage_stores: Arc<RwLock<HashMap<WorkspaceId, WorkspaceUsageStore>>>,
    /// Last cumulative token snapshot per ACP session ID (for delta calculation).
    /// Keyed by acp_session_id. Cleared on kill (not on Dead status change).
    pub(crate) last_session_snapshots: Arc<RwLock<HashMap<String, TurnDelta>>>,
    /// Last cumulative cost snapshot per ACP session ID.
    pub(crate) last_cost_snapshots: Arc<RwLock<HashMap<String, f64>>>,
}

impl ThreadManager {
    pub fn new(
        event_tx: broadcast::Sender<Notification>,
        token_registry: Arc<crate::mcp::TokenRegistry>,
        workspace_state: crate::workspace::SharedWorkspaceState,
        runtime: crate::runtime::SharedRuntime,
    ) -> Self {
        let history: Arc<RwLock<HashMap<String, Vec<Notification>>>> =
            Arc::new(RwLock::new(HashMap::new()));

        let usage_stores: Arc<RwLock<HashMap<WorkspaceId, WorkspaceUsageStore>>> =
            Arc::new(RwLock::new(HashMap::new()));
        let last_session_snapshots: Arc<RwLock<HashMap<String, TurnDelta>>> =
            Arc::new(RwLock::new(HashMap::new()));
        let last_cost_snapshots: Arc<RwLock<HashMap<String, f64>>> =
            Arc::new(RwLock::new(HashMap::new()));

        // Create the threads map up-front so the recorder task and `Self` share
        // the same Arc. This lets the recorder resolve acp_session_id from live
        // handles when keying the snapshot maps.
        let threads: Arc<RwLock<HashMap<String, Arc<Mutex<ThreadHandle>>>>> =
            Arc::new(RwLock::new(HashMap::new()));

        // Spawn background task to record all notifications into per-thread history
        // and to aggregate TurnUsage / TokenUsage into the usage stores.
        let history_clone = history.clone();
        let usage_stores_clone = usage_stores.clone();
        let snapshots_clone = last_session_snapshots.clone();
        let cost_snapshots_clone = last_cost_snapshots.clone();
        let ws_state_clone = workspace_state.clone();
        let threads_recorder_ref = threads.clone();
        let mut recorder_rx: broadcast::Receiver<Notification> = event_tx.subscribe();
        tokio::spawn(async move {
            loop {
                match recorder_rx.recv().await {
                    Ok(notification) => {
                        // --- history ---
                        if let Some(thread_id) = notification.thread_id() {
                            let mut h = history_clone.write().await;
                            h.entry(thread_id.to_string())
                                .or_default()
                                .push(notification.clone());
                        }

                        // --- usage aggregation ---
                        match &notification {
                            Notification::TurnUsage(p) => {
                                let ws_id = WorkspaceId::from(p.workspace_id.as_str());

                                // Key the cumulative snapshot by acp_session_id so that
                                // when a thread is killed and a new session opens, the
                                // high-water mark from the previous session is not reused
                                // (which would clamp the first delta of the new session to
                                // zero via saturating_sub). Fall back to thread_id only
                                // when no live handle with an acp_session_id is found.
                                let acp_session_key = {
                                    let threads = threads_recorder_ref.read().await;
                                    threads
                                        .get(&p.thread_id)
                                        .and_then(|h| {
                                            // Avoid holding the outer RwLock while awaiting
                                            // the inner Mutex — use try_lock to keep it non-blocking.
                                            h.try_lock().ok().and_then(|g| g.acp_session_id.clone())
                                        })
                                        .unwrap_or_else(|| p.thread_id.clone())
                                };

                                // Compute delta from last cumulative snapshot for this session.
                                // ACP usage values are cumulative across the session lifetime.
                                let delta = {
                                    let mut snap = snapshots_clone.write().await;
                                    let prev = snap.entry(acp_session_key.clone()).or_default();
                                    let d = TurnDelta {
                                        input_tokens: p.input_tokens.saturating_sub(prev.input_tokens),
                                        output_tokens: p.output_tokens.saturating_sub(prev.output_tokens),
                                        cached_read_tokens: p.cached_read_tokens.saturating_sub(prev.cached_read_tokens),
                                        cached_write_tokens: p.cached_write_tokens.saturating_sub(prev.cached_write_tokens),
                                        thought_tokens: p.thought_tokens.saturating_sub(prev.thought_tokens),
                                        total_tokens: p.total_tokens.saturating_sub(prev.total_tokens),
                                    };
                                    // Update snapshot to current cumulative value.
                                    prev.input_tokens = p.input_tokens;
                                    prev.output_tokens = p.output_tokens;
                                    prev.cached_read_tokens = p.cached_read_tokens;
                                    prev.cached_write_tokens = p.cached_write_tokens;
                                    prev.thought_tokens = p.thought_tokens;
                                    prev.total_tokens = p.total_tokens;
                                    d
                                };

                                {
                                    let mut stores = usage_stores_clone.write().await;
                                    let store = stores.entry(ws_id.clone()).or_default();
                                    apply_turn_delta(store, &p.agent_definition_id, &delta, &p.at);
                                }

                                // Persist after every turn.
                                Self::persist_workspace_state_static(
                                    &usage_stores_clone,
                                    &ws_id,
                                    &ws_state_clone,
                                )
                                .await;
                            }
                            Notification::TokenUsage(p) => {
                                // Accumulate cost deltas. Keyed by acp_session_id so that
                                // a new session after a kill starts from 0.
                                if let Some(cost_amount) = p.cost_amount {
                                    // Resolve agent_definition_id, workspace_id, and
                                    // acp_session_key for this thread. Skip silently if
                                    // the thread is not found (race on shutdown).
                                    let thread_context = {
                                        let threads = threads_recorder_ref.read().await;
                                        threads.get(&p.thread_id).and_then(|h| {
                                            h.try_lock().ok().map(|g| {
                                                (
                                                    g.agent_id.clone(),
                                                    g.workspace_id.clone(),
                                                    g.acp_session_id
                                                        .clone()
                                                        .unwrap_or_else(|| p.thread_id.clone()),
                                                )
                                            })
                                        })
                                    };

                                    if let Some((agent_definition_id, ws_id, acp_session_key)) =
                                        thread_context
                                    {
                                        let cost_delta = {
                                            let mut cs = cost_snapshots_clone.write().await;
                                            let prev =
                                                cs.entry(acp_session_key).or_insert(0.0);
                                            // cost_amount is cumulative for the session.
                                            let delta = cost_amount - *prev;
                                            *prev = cost_amount;
                                            // A zero or negative delta means we already
                                            // accounted for this cost; skip.
                                            if delta > 0.0 { delta } else { 0.0 }
                                        };

                                        if cost_delta > 0.0 {
                                            let currency_str = p
                                                .cost_currency
                                                .as_deref()
                                                .unwrap_or("usd");
                                            {
                                                let mut stores =
                                                    usage_stores_clone.write().await;
                                                let store =
                                                    stores.entry(ws_id.clone()).or_default();
                                                apply_cost_delta(
                                                    store,
                                                    &agent_definition_id,
                                                    cost_delta,
                                                    currency_str,
                                                );
                                            }
                                            Self::persist_workspace_state_static(
                                                &usage_stores_clone,
                                                &ws_id,
                                                &ws_state_clone,
                                            )
                                            .await;
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        log::warn!("History recorder lagged, missed {} notifications", n);
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });

        Self {
            threads,
            dormant_threads: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
            history,
            token_registry,
            mcp_port: std::sync::atomic::AtomicU16::new(0),
            workspace_state,
            runtime,
            usage_stores,
            last_session_snapshots,
            last_cost_snapshots,
        }
    }

    /// Set the MCP HTTP server port (called after HTTP server binds).
    pub fn set_mcp_port(&self, port: u16) {
        self.mcp_port
            .store(port, std::sync::atomic::Ordering::Relaxed);
    }

    /// Return a clone of the broadcast sender. Used in integration tests to
    /// inject synthetic notifications through the real recorder path.
    pub fn event_sender(&self) -> broadcast::Sender<Notification> {
        self.event_tx.clone()
    }

    /// Generate a short 8-character hex ID from random bytes.
    fn generate_short_id() -> String {
        use std::fmt::Write;
        let mut buf = [0u8; 4];
        getrandom::fill(&mut buf).expect("Failed to generate random bytes");
        let mut id = String::with_capacity(8);
        for byte in &buf {
            write!(id, "{:02x}", byte).unwrap();
        }
        id
    }

    /// Spawn a thread subprocess asynchronously.
    ///
    /// Returns the thread ID immediately. The ACP handshake runs in a background
    /// task and emits `StatusChange(Idle)` or `Error` notifications on completion.
    #[allow(clippy::too_many_arguments)]
    pub async fn spawn_thread(
        &self,
        agent_definition_id: String,
        workspace_id: WorkspaceId,
        container_id: String,
        agent_binary: String,
        task_id: Option<String>,
    ) -> Result<String, String> {
        let thread_id = Self::generate_short_id();

        log::info!(
            "Spawning thread {} (agent: {}, cli: {}, workspace: {}, container: {})",
            &thread_id,
            &agent_definition_id,
            agent_binary,
            workspace_id,
            container_id
        );

        let threads = self.threads.clone();
        let event_tx = self.event_tx.clone();
        let history = self.history.clone();
        let id = thread_id.clone();
        let ws_state = self.workspace_state.clone();

        let bearer_token = self.token_registry.register(&id, task_id.clone());
        let mcp_port = self.mcp_port.load(std::sync::atomic::Ordering::Relaxed);

        let ws_id_for_persist = workspace_id.clone();
        let threads_for_persist = self.threads.clone();
        let dormant_for_persist = self.dormant_threads.clone();
        let usage_stores_for_persist = self.usage_stores.clone();
        let token_registry_for_cleanup = self.token_registry.clone();
        let runtime = self.runtime.read().await;
        let cli_program = runtime.cli_program().to_string();
        let mcp_host_alias = runtime.mcp_host_alias().to_string();
        drop(runtime);

        tokio::spawn(async move {
            match lifecycle::initialize_agent(
                id.clone(),
                agent_definition_id,
                workspace_id,
                container_id,
                agent_binary,
                task_id,
                SessionInit::New,
                threads,
                event_tx.clone(),
                history,
                mcp_port,
                bearer_token,
                cli_program,
                mcp_host_alias,
            )
            .await
            {
                Ok(()) => {
                    log::info!("Thread {} spawned successfully", &id);
                    // Persist thread mappings + usage after successful init
                    let workspace_dir = {
                        let state = ws_state.read().await;
                        state
                            .workspaces
                            .get(&ws_id_for_persist)
                            .map(|ws| ws.path.clone())
                    };
                    if let Some(dir) = workspace_dir {
                        let mappings = Self::collect_mappings_static(
                            &threads_for_persist,
                            &dormant_for_persist,
                            &ws_id_for_persist,
                        )
                        .await;
                        let usage = {
                            let stores = usage_stores_for_persist.read().await;
                            stores.get(&ws_id_for_persist).cloned().unwrap_or_default()
                        };
                        let state = PersistedWorkspaceState {
                            schema_version: 1,
                            threads: mappings,
                            usage,
                        };
                        if let Err(e) = Self::save_state_to_dir(&state, &dir).await {
                            log::error!("Failed to persist workspace state: {}", e);
                        }
                    }
                }
                Err(e) => {
                    log::error!("Thread {} failed to initialize: {}", &id, e);
                    // Revoke the bearer token registered before spawn. Otherwise
                    // the token remains valid in the registry for a thread that
                    // does not exist.
                    token_registry_for_cleanup.revoke_agent(&id);
                    let _ = event_tx.send(Notification::Error(ThreadErrorPayload {
                        thread_id: id,
                        message: e,
                    }));
                }
            }
        });

        Ok(thread_id)
    }

    /// Resume a persisted thread by loading its ACP session.
    ///
    /// Re-uses the original thread ID so the frontend can map it back to
    /// the persisted stub.
    #[allow(clippy::too_many_arguments)]
    pub async fn resume_thread(
        &self,
        thread_id: String,
        agent_definition_id: String,
        workspace_id: WorkspaceId,
        container_id: String,
        agent_binary: String,
        acp_session_id: String,
        task_id: Option<String>,
    ) -> Result<(), String> {
        // Check if thread is already live
        {
            let threads = self.threads.read().await;
            if threads.contains_key(&thread_id) {
                return Err(format!("Thread '{}' is already running", thread_id));
            }
        }

        log::info!(
            "Resuming thread {} (agent: {}, session: {}, workspace: {})",
            &thread_id,
            &agent_definition_id,
            &acp_session_id,
            &workspace_id,
        );

        let threads = self.threads.clone();
        let dormant = self.dormant_threads.clone();
        let event_tx = self.event_tx.clone();
        let history = self.history.clone();
        let id = thread_id.clone();
        let ws_id_for_promotion = workspace_id.clone();

        let bearer_token = self.token_registry.register(&id, task_id.clone());
        let mcp_port = self.mcp_port.load(std::sync::atomic::Ordering::Relaxed);
        let token_registry_for_cleanup = self.token_registry.clone();
        let runtime = self.runtime.read().await;
        let cli_program = runtime.cli_program().to_string();
        let mcp_host_alias = runtime.mcp_host_alias().to_string();
        drop(runtime);

        tokio::spawn(async move {
            match lifecycle::initialize_agent(
                id.clone(),
                agent_definition_id,
                workspace_id,
                container_id,
                agent_binary,
                task_id,
                SessionInit::Load { acp_session_id },
                threads,
                event_tx.clone(),
                history,
                mcp_port,
                bearer_token,
                cli_program,
                mcp_host_alias,
            )
            .await
            {
                Ok(()) => {
                    log::info!("Thread {} resumed successfully", &id);
                    // Promote: the live entry is now registered in `threads`
                    // by initialize_agent, so remove the dormant stub.
                    let mut dormant_guard = dormant.write().await;
                    if let Some(ws_map) = dormant_guard.get_mut(&ws_id_for_promotion) {
                        ws_map.remove(&id);
                    }
                }
                Err(e) => {
                    log::error!("Thread {} failed to resume: {}", &id, e);
                    // Leave the dormant entry intact so the user can retry.
                    token_registry_for_cleanup.revoke_agent(&id);
                    let _ = event_tx.send(Notification::Error(ThreadErrorPayload {
                        thread_id: id,
                        message: e,
                    }));
                }
            }
        });

        Ok(())
    }

    /// Queue a user prompt for a thread.
    pub async fn queue_prompt(
        &self,
        thread_id: &str,
        text: String,
    ) -> Result<oneshot::Receiver<Result<(), String>>, String> {
        let handle_arc = {
            let threads = self.threads.read().await;
            threads
                .get(thread_id)
                .cloned()
                .ok_or_else(|| format!("Thread '{}' not found", thread_id))?
        };

        let mut handle = handle_arc.lock().await;

        if handle.completing {
            return Err(format!(
                "Thread '{}' has completed its task and is shutting down",
                thread_id
            ));
        }
        if handle.pending_prompt.is_some() {
            return Err(format!(
                "Thread '{}' already has a pending prompt",
                thread_id
            ));
        }
        if handle.status != AgentStatus::Idle {
            return Err(format!(
                "Thread '{}' is not idle (current status: {})",
                thread_id, handle.status
            ));
        }

        let (reply_tx, reply_rx) = oneshot::channel();
        handle.pending_prompt = Some((text, reply_tx));
        handle.prompt_notify.notify_one();

        Ok(reply_rx)
    }

    /// Wake a thread's prompt loop.
    pub async fn notify_prompt_loop(&self, thread_id: &str) {
        let threads = self.threads.read().await;
        if let Some(handle_arc) = threads.get(thread_id) {
            let handle = handle_arc.lock().await;
            handle.prompt_notify.notify_one();
        }
    }

    /// Cancel the current prompt on a thread.
    pub async fn cancel_prompt(&self, thread_id: &str) -> Result<(), String> {
        let handle_arc = {
            let threads = self.threads.read().await;
            threads
                .get(thread_id)
                .cloned()
                .ok_or_else(|| format!("Thread '{}' not found", thread_id))?
        };

        let handle = handle_arc.lock().await;

        if handle.status != AgentStatus::Working {
            return Ok(());
        }

        let (reply_tx, reply_rx) = oneshot::channel();
        handle
            .command_tx
            .send(AgentCommand::Cancel { reply: reply_tx })
            .map_err(|_| "Thread has terminated".to_string())?;

        drop(handle);

        reply_rx
            .await
            .map_err(|_| "Thread terminated during cancel".to_string())?
    }

    /// Shut down a thread's subprocess and remove it from the in-memory map,
    /// but leave its persisted `threads.json` entry intact. Returns the
    /// workspace the thread belonged to, or `None` if the thread was not
    /// found.
    ///
    /// Use this for task-completion teardown, where the process should stop
    /// but the session mapping must remain resumable. Callers that want the
    /// mapping purged from disk should use `kill_thread` instead.
    ///
    /// Does NOT handle topology cleanup — that's the coordinator's job.
    pub async fn shutdown_thread(
        &self,
        thread_id: &str,
    ) -> Result<Option<WorkspaceId>, String> {
        log::info!("Shutting down thread {}", thread_id);

        let _ = self
            .event_tx
            .send(Notification::StatusChange(StatusChangePayload {
                thread_id: thread_id.to_string(),
                status: AgentStatus::Dead.to_string(),
            }));

        let handle_arc = {
            let mut threads = self.threads.write().await;
            match threads.remove(thread_id) {
                Some(h) => h,
                None => return Ok(None),
            }
        };

        let mut handle = handle_arc.lock().await;
        let workspace_id = handle.workspace_id.clone();

        // Capture the mapping now; ThreadMapping fields are immutable over
        // a thread's lifetime, so this snapshot is safe to demote later.
        let mapping = ThreadMapping {
            thread_id: thread_id.to_string(),
            agent_definition_id: handle.agent_id.clone(),
            acp_session_id: handle.acp_session_id.clone(),
            task_id: handle.task_id.clone(),
        };

        if let Some(loop_handle) = handle.prompt_loop_handle.take() {
            loop_handle.abort();
        }

        let _ = handle.command_tx.send(AgentCommand::Shutdown);

        let _ = handle
            .process
            .shutdown(std::time::Duration::from_secs(2))
            .await;

        drop(handle.thread_handle.take());
        drop(handle);

        // Demote to dormant. We've already dropped the live entry + lock
        // above, so no risk of holding both locks simultaneously.
        {
            let mut dormant = self.dormant_threads.write().await;
            dormant
                .entry(workspace_id.clone())
                .or_default()
                .insert(thread_id.to_string(), mapping);
        }

        self.token_registry.revoke_agent(thread_id);

        Ok(Some(workspace_id))
    }

    /// Kill a thread: shut down its subprocess if live, remove it from the
    /// in-memory maps (live and dormant), and purge its entry from
    /// `threads.json`. Also clears session snapshots so the next session
    /// starts fresh (avoids double-counting on resume with a new session ID).
    pub async fn kill_thread(&self, thread_id: &str) -> Result<(), String> {
        // Resolve the current acp_session_id before we tear down the live handle,
        // so we can clear the primary snapshot key (keyed by acp_session_id).
        let acp_session_id_opt: Option<String> = {
            let threads = self.threads.read().await;
            threads
                .get(thread_id)
                .and_then(|h| h.try_lock().ok().and_then(|g| g.acp_session_id.clone()))
        };

        // Clear usage snapshots so the next session starts fresh.
        // Primary key is acp_session_id; also remove by thread_id as a defensive fallback.
        {
            let mut snap = self.last_session_snapshots.write().await;
            if let Some(ref sid) = acp_session_id_opt {
                snap.remove(sid.as_str());
            }
            snap.remove(thread_id);
        }
        {
            let mut cs = self.last_cost_snapshots.write().await;
            if let Some(ref sid) = acp_session_id_opt {
                cs.remove(sid.as_str());
            }
            cs.remove(thread_id);
        }

        // Try the live path first. shutdown_thread demotes to dormant;
        // since this is a kill, we then also purge from dormant.
        if let Some(workspace_id) = self.shutdown_thread(thread_id).await? {
            {
                let mut dormant = self.dormant_threads.write().await;
                if let Some(ws_map) = dormant.get_mut(&workspace_id) {
                    ws_map.remove(thread_id);
                }
            }
            self.persist_threads_for_workspace(&workspace_id).await;
            return Ok(());
        }

        // Not live — look up in dormant and purge from there.
        let workspace_id = {
            let mut dormant = self.dormant_threads.write().await;
            let mut found_ws: Option<WorkspaceId> = None;
            for (ws, ws_map) in dormant.iter_mut() {
                if ws_map.remove(thread_id).is_some() {
                    found_ws = Some(ws.clone());
                    break;
                }
            }
            found_ws
        };

        if let Some(workspace_id) = workspace_id {
            self.token_registry.revoke_agent(thread_id);
            self.persist_threads_for_workspace(&workspace_id).await;
        }

        Ok(())
    }

    /// Kill all threads (live and dormant) belonging to a given workspace.
    pub async fn kill_threads_in_workspace(
        &self,
        workspace_id: &WorkspaceId,
    ) -> Result<(), String> {
        let mut to_kill: Vec<String> = Vec::new();

        {
            let threads = self.threads.read().await;
            for (id, handle_arc) in threads.iter() {
                let handle = handle_arc.lock().await;
                if &handle.workspace_id == workspace_id {
                    to_kill.push(id.clone());
                }
            }
        }
        {
            let dormant = self.dormant_threads.read().await;
            if let Some(ws_map) = dormant.get(workspace_id) {
                for id in ws_map.keys() {
                    if !to_kill.contains(id) {
                        to_kill.push(id.clone());
                    }
                }
            }
        }

        for id in to_kill {
            self.kill_thread(&id).await?;
        }

        Ok(())
    }

    /// Kill all threads belonging to a given agent definition.
    /// Walks both live and dormant maps.
    pub async fn kill_threads_for_agent(&self, agent_definition_id: &str) -> Result<(), String> {
        let mut to_kill: Vec<String> = Vec::new();

        // Live candidates.
        let candidates: Vec<(String, Arc<Mutex<ThreadHandle>>)> = {
            let threads = self.threads.read().await;
            threads
                .iter()
                .map(|(id, handle_arc)| (id.clone(), handle_arc.clone()))
                .collect()
        };
        for (id, handle_arc) in candidates {
            let handle = handle_arc.lock().await;
            if handle.agent_id == agent_definition_id {
                to_kill.push(id);
            }
        }

        // Dormant candidates.
        {
            let dormant = self.dormant_threads.read().await;
            for ws_map in dormant.values() {
                for (id, m) in ws_map.iter() {
                    if m.agent_definition_id == agent_definition_id && !to_kill.contains(id) {
                        to_kill.push(id.clone());
                    }
                }
            }
        }

        for id in to_kill {
            self.kill_thread(&id).await?;
        }

        Ok(())
    }

    /// Count running threads grouped by workspace.
    pub async fn thread_count_by_workspace(&self) -> HashMap<WorkspaceId, usize> {
        let threads = self.threads.read().await;
        let mut counts: HashMap<WorkspaceId, usize> = HashMap::new();
        for handle_arc in threads.values() {
            let handle = handle_arc.lock().await;
            *counts.entry(handle.workspace_id.clone()).or_default() += 1;
        }
        counts
    }

    /// List threads for a specific agent definition. Returns both live and
    /// dormant entries, deduping by thread_id (live wins). Dormant entries
    /// carry `status = "dead"`.
    pub async fn list_threads(&self, agent_definition_id: &str) -> Vec<ThreadSummary> {
        let mut result: Vec<ThreadSummary> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

        {
            let threads = self.threads.read().await;
            for (id, handle_arc) in threads.iter() {
                let handle = handle_arc.lock().await;
                if handle.agent_id == agent_definition_id {
                    result.push(ThreadSummary {
                        id: id.clone(),
                        agent_id: handle.agent_id.clone(),
                        status: handle.status.to_string(),
                        workspace_id: handle.workspace_id.clone(),
                        acp_session_id: handle.acp_session_id.clone(),
                    });
                    seen.insert(id.clone());
                }
            }
        }

        {
            let dormant = self.dormant_threads.read().await;
            for (ws_id, ws_map) in dormant.iter() {
                for (id, m) in ws_map {
                    if m.agent_definition_id == agent_definition_id && seen.insert(id.clone()) {
                        result.push(ThreadSummary {
                            id: id.clone(),
                            agent_id: m.agent_definition_id.clone(),
                            status: AgentStatus::Dead.to_string(),
                            workspace_id: ws_id.clone(),
                            acp_session_id: m.acp_session_id.clone(),
                        });
                    }
                }
            }
        }

        result
    }

    /// Get the current config options for a thread.
    pub async fn get_config(&self, thread_id: &str) -> Result<Vec<ConfigOption>, String> {
        let handle_arc = {
            let threads = self.threads.read().await;
            threads
                .get(thread_id)
                .cloned()
                .ok_or_else(|| format!("Thread '{}' not found", thread_id))?
        };
        let handle = handle_arc.lock().await;
        Ok(handle.config_options.clone())
    }

    /// Set a config option on a thread via ACP.
    pub async fn set_config(
        &self,
        thread_id: &str,
        config_id: String,
        value: String,
    ) -> Result<Vec<ConfigOption>, String> {
        let handle_arc = {
            let threads = self.threads.read().await;
            threads
                .get(thread_id)
                .cloned()
                .ok_or_else(|| format!("Thread '{}' not found", thread_id))?
        };

        let (reply_tx, reply_rx) = oneshot::channel();
        {
            let handle = handle_arc.lock().await;
            handle
                .command_tx
                .send(AgentCommand::SetConfig {
                    config_id,
                    value,
                    reply: reply_tx,
                })
                .map_err(|_| "Thread has terminated".to_string())?;
        }

        let new_config = reply_rx
            .await
            .map_err(|_| "Thread terminated during set_config".to_string())??;

        {
            let mut handle = handle_arc.lock().await;
            let old_config = std::mem::replace(&mut handle.config_options, new_config.clone());
            let changes = crate::config::diff_config(&old_config, &new_config);
            if !changes.is_empty() {
                let _ = self
                    .event_tx
                    .send(Notification::ConfigUpdate(ConfigUpdatePayload {
                        thread_id: thread_id.to_string(),
                        config_options: new_config.clone(),
                        changes,
                    }));
            }
        }

        Ok(new_config)
    }

    /// Get notification history for a thread.
    pub async fn get_history(&self, thread_id: &str) -> Result<Vec<Notification>, String> {
        let history = self.history.read().await;
        history
            .get(thread_id)
            .cloned()
            .ok_or_else(|| format!("Thread '{}' not found", thread_id))
    }

    /// Check if a thread is idle.
    pub async fn is_thread_idle(&self, thread_id: &str) -> bool {
        let threads = self.threads.read().await;
        match threads.get(thread_id) {
            Some(h) => h.lock().await.status == AgentStatus::Idle,
            None => false,
        }
    }

    /// Check if a thread has management permissions.
    pub async fn has_management_permissions(&self, thread_id: &str) -> bool {
        let threads = self.threads.read().await;
        match threads.get(thread_id) {
            Some(handle_arc) => handle_arc.lock().await.has_management_permissions,
            None => false,
        }
    }

    /// Mark a thread as completing its task. Blocks further prompts; the
    /// thread itself is torn down separately once the current turn drains.
    /// Returns `Ok(())` even if already marked (idempotent).
    pub async fn mark_thread_completing(&self, thread_id: &str) -> Result<(), String> {
        let threads = self.threads.read().await;
        let handle_arc = threads
            .get(thread_id)
            .ok_or_else(|| format!("Thread '{}' not found", thread_id))?;
        handle_arc.lock().await.completing = true;
        Ok(())
    }

    /// Set management permissions for a thread.
    pub async fn set_management_permissions(
        &self,
        thread_id: &str,
        enabled: bool,
    ) -> Result<(), String> {
        let threads = self.threads.read().await;
        let handle_arc = threads
            .get(thread_id)
            .ok_or_else(|| format!("Thread not found: {}", thread_id))?;
        handle_arc.lock().await.has_management_permissions = enabled;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Dormant map
    // -----------------------------------------------------------------------

    /// Insert persisted-but-not-live thread mappings for a workspace.
    /// Called at startup once per workspace after `load_from_dir`.
    pub async fn hydrate_dormant_for_workspace(
        &self,
        workspace_id: &WorkspaceId,
        mappings: Vec<ThreadMapping>,
    ) {
        let mut dormant = self.dormant_threads.write().await;
        let entry = dormant.entry(workspace_id.clone()).or_default();
        for m in mappings {
            entry.insert(m.thread_id.clone(), m);
        }
    }

    /// Return a snapshot of dormant entries for a workspace.
    pub async fn dormant_snapshot_for_workspace(
        &self,
        workspace_id: &WorkspaceId,
    ) -> HashMap<String, ThreadMapping> {
        self.dormant_threads
            .read()
            .await
            .get(workspace_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Flat snapshot of all dormant entries across workspaces, keyed by
    /// `thread_id`. Used for lookups when only a thread_id is known.
    pub async fn dormant_snapshot(&self) -> HashMap<String, ThreadMapping> {
        let dormant = self.dormant_threads.read().await;
        let mut flat = HashMap::new();
        for ws_map in dormant.values() {
            for (id, m) in ws_map {
                flat.insert(id.clone(), m.clone());
            }
        }
        flat
    }

    /// Inject a usage delta for a workspace. Intended for integration tests
    /// only — production code populates the store via the recorder background task.
    pub async fn apply_usage_delta_for_test(
        &self,
        workspace_id: &WorkspaceId,
        agent_id: &str,
        delta: &super::usage_store::TurnDelta,
        at: &str,
    ) {
        let mut stores = self.usage_stores.write().await;
        let store = stores.entry(workspace_id.clone()).or_default();
        super::usage_store::apply_turn_delta(store, agent_id, delta, at);
    }

    /// Register a workspace in the manager's shared state. Intended for
    /// integration tests — production code flows through `WorkspaceManager`.
    pub async fn register_workspace_for_test(
        &self,
        workspace_id: WorkspaceId,
        path: std::path::PathBuf,
        container_status: emergent_protocol::ContainerStatus,
    ) {
        use crate::workspace::Workspace;
        let mut state = self.workspace_state.write().await;
        state.workspaces.insert(
            workspace_id,
            Workspace {
                name: "test-ws".into(),
                path,
                container_id: None,
                container_status,
            },
        );
    }

    /// Register a fake live thread in the threads map for integration tests.
    /// The handle has a stub process and an mpsc channel that is never polled.
    /// Intended for recorder-path tests that need to resolve `acp_session_id`
    /// from the live map without spawning a real container.
    pub async fn register_live_thread_for_test(
        &self,
        thread_id: String,
        agent_definition_id: String,
        workspace_id: WorkspaceId,
        acp_session_id: Option<String>,
    ) {
        use crate::agent::spawner::RuntimeCliProcess;
        use tokio::sync::mpsc;

        let (command_tx, _command_rx) = mpsc::unbounded_channel();

        // Spawn a no-op child process that exits immediately. This is the
        // minimal `Child` required by `RuntimeCliProcess`.
        let child = tokio::process::Command::new("true")
            .spawn()
            .expect("failed to spawn 'true' for test stub");
        let process = RuntimeCliProcess::new_for_test(child);

        let handle = super::ThreadHandle {
            agent_id: agent_definition_id,
            acp_session_id,
            status: emergent_protocol::AgentStatus::Idle,
            workspace_id,
            command_tx,
            process,
            thread_handle: None,
            config_options: Vec::new(),
            has_management_permissions: false,
            has_prompted: false,
            task_id: None,
            completing: false,
            last_prompted_permissions: false,
            prompt_notify: Arc::new(tokio::sync::Notify::new()),
            pending_prompt: None,
            prompt_loop_handle: None,
        };

        let mut threads = self.threads.write().await;
        threads.insert(thread_id, Arc::new(Mutex::new(handle)));
    }

    /// Update the `acp_session_id` on a live thread handle. Used in tests to
    /// simulate session renewal after a kill+respawn cycle.
    pub async fn set_acp_session_id_for_test(
        &self,
        thread_id: &str,
        acp_session_id: Option<String>,
    ) {
        let threads = self.threads.read().await;
        if let Some(h) = threads.get(thread_id) {
            h.lock().await.acp_session_id = acp_session_id;
        }
    }

    /// Remove the cumulative token snapshot for a given acp_session_id.
    /// Mirrors what `kill_thread` does; exposed for integration tests.
    pub async fn clear_session_snapshot_for_test(&self, acp_session_id: &str) {
        self.last_session_snapshots
            .write()
            .await
            .remove(acp_session_id);
        self.last_cost_snapshots
            .write()
            .await
            .remove(acp_session_id);
    }

    // -----------------------------------------------------------------------
    // Persistence
    // -----------------------------------------------------------------------

    /// Persist all thread mappings + usage store for a given workspace.
    pub async fn persist_threads_for_workspace(&self, workspace_id: &WorkspaceId) {
        let workspace_dir = {
            let state = self.workspace_state.read().await;
            match state.workspaces.get(workspace_id) {
                Some(ws) => ws.path.clone(),
                None => return,
            }
        };

        let mappings = Self::collect_mappings_static(
            &self.threads,
            &self.dormant_threads,
            workspace_id,
        )
        .await;

        let usage = {
            let stores = self.usage_stores.read().await;
            stores.get(workspace_id).cloned().unwrap_or_default()
        };

        let state = PersistedWorkspaceState {
            schema_version: 1,
            threads: mappings,
            usage,
        };

        if let Err(e) = Self::save_state_to_dir(&state, &workspace_dir).await {
            log::error!("Failed to persist workspace state: {}", e);
        }
    }

    /// Static helper used from recorder task to persist usage without a &self ref.
    async fn persist_workspace_state_static(
        usage_stores: &Arc<RwLock<HashMap<WorkspaceId, WorkspaceUsageStore>>>,
        workspace_id: &WorkspaceId,
        ws_state: &crate::workspace::SharedWorkspaceState,
    ) {
        let workspace_dir = {
            let state = ws_state.read().await;
            match state.workspaces.get(workspace_id) {
                Some(ws) => ws.path.clone(),
                None => return,
            }
        };

        // We only have the usage half here; threads are not available.
        // Write a partial file update: read current threads from disk, merge usage.
        let current_threads = match Self::load_full_state_from_dir(&workspace_dir).await {
            Ok(s) => s.threads,
            Err(_) => Vec::new(),
        };

        let usage = {
            let stores = usage_stores.read().await;
            stores.get(workspace_id).cloned().unwrap_or_default()
        };

        let state = PersistedWorkspaceState {
            schema_version: 1,
            threads: current_threads,
            usage,
        };

        if let Err(e) = Self::save_state_to_dir(&state, &workspace_dir).await {
            log::error!("Failed to persist usage to workspace state: {}", e);
        }
    }

    /// Collect thread mappings for a workspace. Unions live and dormant maps,
    /// deduping by `thread_id` (live wins).
    async fn collect_mappings_static(
        threads: &RwLock<HashMap<String, Arc<Mutex<ThreadHandle>>>>,
        dormant: &RwLock<HashMap<WorkspaceId, HashMap<String, ThreadMapping>>>,
        workspace_id: &WorkspaceId,
    ) -> Vec<ThreadMapping> {
        let mut out: Vec<ThreadMapping> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

        {
            let live = threads.read().await;
            for (id, handle_arc) in live.iter() {
                let handle = handle_arc.lock().await;
                if &handle.workspace_id == workspace_id {
                    out.push(ThreadMapping {
                        thread_id: id.clone(),
                        agent_definition_id: handle.agent_id.clone(),
                        acp_session_id: handle.acp_session_id.clone(),
                        task_id: handle.task_id.clone(),
                    });
                    seen.insert(id.clone());
                }
            }
        }

        let dormant_guard = dormant.read().await;
        if let Some(ws_map) = dormant_guard.get(workspace_id) {
            for (id, m) in ws_map {
                if seen.insert(id.clone()) {
                    out.push(m.clone());
                }
            }
        }
        out
    }

    async fn save_state_to_dir(
        state: &PersistedWorkspaceState,
        workspace_dir: &Path,
    ) -> Result<(), String> {
        let json = serde_json::to_string_pretty(state)
            .map_err(|e| format!("Failed to serialize workspace state: {}", e))?;
        let path = workspace_dir.join("threads.json");
        let tmp_path = workspace_dir.join("threads.json.tmp");
        tokio::fs::write(&tmp_path, &json)
            .await
            .map_err(|e| format!("Failed to write threads.json.tmp: {}", e))?;
        tokio::fs::rename(&tmp_path, &path)
            .await
            .map_err(|e| format!("Failed to rename threads.json.tmp: {}", e))?;
        Ok(())
    }

    /// Load full persisted state (threads + usage) from `threads.json`.
    /// Handles v0 (bare array) and v1 (envelope object) formats.
    async fn load_full_state_from_dir(
        workspace_dir: &Path,
    ) -> Result<PersistedWorkspaceState, String> {
        let path = workspace_dir.join("threads.json");
        if !path.exists() {
            return Ok(PersistedWorkspaceState::default());
        }
        let raw = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| format!("Failed to read threads.json: {}", e))?;

        // Two-attempt backward-compat parse:
        // v1 files start with `{`, v0 files with `[`.
        match serde_json::from_str::<PersistedWorkspaceState>(&raw) {
            Ok(envelope) => Ok(envelope),
            Err(_) => {
                // Try v0: bare Vec<ThreadMapping>
                let threads: Vec<ThreadMapping> = serde_json::from_str(&raw)
                    .map_err(|e| format!("Failed to parse threads.json: {}", e))?;
                Ok(PersistedWorkspaceState {
                    schema_version: 0,
                    threads,
                    usage: Default::default(),
                })
            }
        }
    }

    /// Load persisted thread mappings from `threads.json`.
    /// Returns only the thread list (backward-compat shim used by callers that
    /// do not need usage data).
    pub async fn load_from_dir(workspace_dir: &Path) -> Result<Vec<ThreadMapping>, String> {
        Ok(Self::load_full_state_from_dir(workspace_dir).await?.threads)
    }

    /// Seed the in-memory usage store for a workspace from persisted state.
    pub async fn seed_usage_from_dir(&self, workspace_id: &WorkspaceId, workspace_dir: &Path) {
        match Self::load_full_state_from_dir(workspace_dir).await {
            Ok(state) => {
                if !state.usage.agents.is_empty() || !state.usage.recent_turns.is_empty() {
                    let mut stores = self.usage_stores.write().await;
                    stores.insert(workspace_id.clone(), state.usage);
                }
            }
            Err(e) => {
                log::warn!(
                    "Failed to seed usage for workspace '{}': {}",
                    workspace_id,
                    e
                );
            }
        }
    }

    /// Return the current usage snapshot for a workspace.
    pub async fn get_workspace_usage(&self, workspace_id: &WorkspaceId) -> WorkspaceUsageStore {
        let stores = self.usage_stores.read().await;
        stores.get(workspace_id).cloned().unwrap_or_default()
    }
}
