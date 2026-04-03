use std::collections::HashMap;
use std::sync::Arc;

use emergent_protocol::{
    AgentErrorPayload, AgentStatus, AgentSummary, ConfigOption, ConfigUpdatePayload, Notification,
    StatusChangePayload, ThreadSummary, WorkspaceId,
};
use tokio::sync::{broadcast, oneshot, Mutex, RwLock};

use super::spawner::AgentProcess;
use super::{lifecycle, AgentCommand, ThreadHandle};

pub struct ThreadManager {
    pub(crate) threads: Arc<RwLock<HashMap<String, Arc<Mutex<ThreadHandle>>>>>,
    pub(crate) event_tx: broadcast::Sender<Notification>,
    pub(crate) history: Arc<RwLock<HashMap<String, Vec<Notification>>>>,
    pub(crate) token_registry: Arc<crate::mcp::TokenRegistry>,
    pub(crate) mcp_port: std::sync::atomic::AtomicU16,
}

impl ThreadManager {
    pub fn new(
        event_tx: broadcast::Sender<Notification>,
        token_registry: Arc<crate::mcp::TokenRegistry>,
    ) -> Self {
        let history: Arc<RwLock<HashMap<String, Vec<Notification>>>> =
            Arc::new(RwLock::new(HashMap::new()));

        // Spawn background task to record all notifications into per-thread history
        let history_clone = history.clone();
        let mut recorder_rx: broadcast::Receiver<Notification> = event_tx.subscribe();
        tokio::spawn(async move {
            loop {
                match recorder_rx.recv().await {
                    Ok(notification) => {
                        if let Some(agent_id) = notification.agent_id() {
                            let mut h = history_clone.write().await;
                            h.entry(agent_id.to_string())
                                .or_default()
                                .push(notification);
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
            threads: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
            history,
            token_registry,
            mcp_port: std::sync::atomic::AtomicU16::new(0),
        }
    }

    /// Set the MCP HTTP server port (called after HTTP server binds).
    pub fn set_mcp_port(&self, port: u16) {
        self.mcp_port
            .store(port, std::sync::atomic::Ordering::Relaxed);
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
    pub async fn spawn_thread(
        &self,
        agent_definition_id: String,
        workspace_id: WorkspaceId,
        container_id: String,
        agent_binary: String,
        role: Option<String>,
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

        let bearer_token = self.token_registry.register(&id);
        let mcp_port = self
            .mcp_port
            .load(std::sync::atomic::Ordering::Relaxed);

        tokio::spawn(async move {
            match lifecycle::initialize_agent(
                id.clone(),
                agent_definition_id,
                workspace_id,
                container_id,
                agent_binary,
                role,
                threads,
                event_tx.clone(),
                history,
                mcp_port,
                bearer_token,
            )
            .await
            {
                Ok(()) => {
                    log::info!("Thread {} spawned successfully", &id);
                }
                Err(e) => {
                    log::error!("Thread {} failed to initialize: {}", &id, e);
                    let _ = event_tx.send(Notification::Error(AgentErrorPayload {
                        agent_id: id,
                        message: e,
                    }));
                }
            }
        });

        Ok(thread_id)
    }

    /// Queue a user prompt for a thread.
    pub async fn queue_prompt(
        &self,
        thread_id: &str,
        text: String,
        role: Option<String>,
    ) -> Result<oneshot::Receiver<Result<(), String>>, String> {
        let handle_arc = {
            let threads = self.threads.read().await;
            threads
                .get(thread_id)
                .cloned()
                .ok_or_else(|| format!("Thread '{}' not found", thread_id))?
        };

        let mut handle = handle_arc.lock().await;

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

        // Set role on first prompt if provided.
        if !handle.has_prompted {
            if let Some(r) = role {
                handle.role = Some(r);
            }
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

    /// Kill a thread, removing it from the map and terminating the subprocess.
    /// Does NOT handle topology cleanup — that's the coordinator's job.
    pub async fn kill_thread(&self, thread_id: &str) -> Result<(), String> {
        log::info!("Killing thread {}", thread_id);

        let _ = self
            .event_tx
            .send(Notification::StatusChange(StatusChangePayload {
                agent_id: thread_id.to_string(),
                status: AgentStatus::Dead.to_string(),
            }));

        let handle_arc = {
            let mut threads = self.threads.write().await;
            match threads.remove(thread_id) {
                Some(h) => h,
                None => return Ok(()),
            }
        };

        let mut handle = handle_arc.lock().await;

        if let Some(loop_handle) = handle.prompt_loop_handle.take() {
            loop_handle.abort();
        }

        let _ = handle.command_tx.send(AgentCommand::Shutdown);

        let exited = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            handle.process.wait(),
        )
        .await;
        if exited.is_err() {
            let _ = handle.process.kill().await;
        }

        drop(handle.thread_handle.take());

        // Revoke bearer token
        self.token_registry.revoke_agent(thread_id);

        Ok(())
    }

    /// Kill all threads belonging to a given agent definition.
    pub async fn kill_threads_for_agent(&self, agent_definition_id: &str) -> Result<(), String> {
        let thread_ids: Vec<String> = {
            let threads = self.threads.read().await;
            threads
                .iter()
                .filter_map(|(id, handle_arc)| {
                    // We need to check without async — use try_lock
                    if let Ok(handle) = handle_arc.try_lock() {
                        if handle.agent_id == agent_definition_id {
                            return Some(id.clone());
                        }
                    }
                    None
                })
                .collect()
        };

        for id in thread_ids {
            self.kill_thread(&id).await?;
        }

        Ok(())
    }

    /// List all running threads as summaries.
    pub async fn list_all_threads(&self) -> Vec<AgentSummary> {
        let threads = self.threads.read().await;
        let mut result = Vec::new();
        for (id, handle_arc) in threads.iter() {
            let handle = handle_arc.lock().await;
            result.push(AgentSummary {
                id: id.clone(),
                cli: handle.cli.clone(),
                status: handle.status.to_string(),
                workspace_id: handle.workspace_id.clone(),
                role: handle.role.clone(),
            });
        }
        result
    }

    /// List threads for a specific agent definition.
    pub async fn list_threads(&self, agent_definition_id: &str) -> Vec<ThreadSummary> {
        let threads = self.threads.read().await;
        let mut result = Vec::new();
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
                        agent_id: thread_id.to_string(),
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
}
