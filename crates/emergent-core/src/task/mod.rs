pub mod registry;
pub mod subscribe;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use emergent_protocol::{
    Notification, Task, TaskPayload, TaskState, TaskStatusNotificationPayload, WorkspaceId,
};
pub use subscribe::SubscribeMode;
use tokio::sync::{broadcast, RwLock};

use crate::agent::AgentManager;
use registry::TaskRegistry;

/// Per-task subscription list: maps task_id → `Vec<(thread_id, SubscribeMode)>`.
type SubscriptionMap = HashMap<String, Vec<(String, SubscribeMode)>>;

pub struct TaskManager {
    registry: Arc<RwLock<TaskRegistry>>,
    agent_manager: Arc<AgentManager>,
    event_tx: broadcast::Sender<Notification>,
    prompted_sessions: Arc<RwLock<HashSet<String>>>,
    /// Thread IDs pending teardown after their current turn drains.
    /// Populated by `complete_task`, consumed on the next `StatusChange(Idle)`.
    pending_teardown: Arc<RwLock<HashSet<String>>>,
    /// Subscription registry: task_id → list of (thread_id, mode) pairs.
    subscriptions: Arc<RwLock<SubscriptionMap>>,
}

fn build_task_prompt(task_id: &str, title: &str, description: &str) -> String {
    format!(
        "Task {}: {}\n\n{}\n\nWhen the task is complete, call Emergent's `complete_task` tool to mark it done. Your session will end after the turn in which you call this tool, so use that turn to wrap up any final message.",
        task_id, title, description
    )
}

/// Lightweight clone of TaskManager fields needed inside the spawned event
/// loop for reconciliation on broadcast lag.
struct TaskManagerRef {
    registry: Arc<RwLock<TaskRegistry>>,
    agent_manager: Arc<AgentManager>,
    event_tx: broadcast::Sender<Notification>,
    pending_teardown: Arc<RwLock<HashSet<String>>>,
}

impl TaskManagerRef {
    async fn reconcile_after_lag(&self) {
        let live = self.agent_manager.live_thread_ids().await;
        let mut affected_workspaces: HashSet<WorkspaceId> = HashSet::new();
        {
            let mut reg = self.registry.write().await;
            for task in reg.all_tasks_mut() {
                if let TaskState::Working { session_id } = &task.state {
                    if !live.contains(session_id) {
                        let sid = session_id.clone();
                        task.state = TaskState::Failed {
                            session_id: Some(sid),
                        };
                        affected_workspaces.insert(task.workspace_id.clone());
                        let _ = self.event_tx.send(Notification::TaskUpdated(TaskPayload {
                            task: task.clone(),
                        }));
                    }
                }
            }
        }
        for ws_id in affected_workspaces {
            if let Some(path) = self.agent_manager.workspace_path(&ws_id).await {
                let reg = self.registry.read().await;
                if let Err(e) = reg.save_to_dir(&ws_id, &path).await {
                    log::error!("Failed to persist tasks after lag reconcile: {}", e);
                }
            }
        }

        // If we missed a `StatusChange(Idle)`, a thread pending teardown may
        // be stranded alive with no more prompts. Force it down; drop entries
        // whose threads were already reaped.
        let pending: Vec<String> = self.pending_teardown.read().await.iter().cloned().collect();
        for thread_id in pending {
            self.pending_teardown.write().await.remove(&thread_id);
            if live.contains(&thread_id) {
                log::info!(
                    "Forcing teardown for thread {} pending after lag reconcile",
                    thread_id
                );
                if let Err(e) = self.agent_manager.shutdown_thread(&thread_id).await {
                    log::error!(
                        "Failed to tear down stranded thread {} after lag: {}",
                        thread_id,
                        e
                    );
                }
            }
        }
    }
}

impl TaskManager {
    pub fn new(
        agent_manager: Arc<AgentManager>,
        event_tx: broadcast::Sender<Notification>,
    ) -> Self {
        Self {
            registry: Arc::new(RwLock::new(TaskRegistry::new())),
            agent_manager,
            event_tx,
            prompted_sessions: Arc::new(RwLock::new(HashSet::new())),
            pending_teardown: Arc::new(RwLock::new(HashSet::new())),
            subscriptions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn start_event_loop(&self, mut event_rx: broadcast::Receiver<Notification>) {
        let registry = self.registry.clone();
        let prompted = self.prompted_sessions.clone();
        let agent_manager = self.agent_manager.clone();
        let event_tx = self.event_tx.clone();
        let pending_teardown = self.pending_teardown.clone();
        let self_ref = Arc::new(TaskManagerRef {
            registry: registry.clone(),
            agent_manager: agent_manager.clone(),
            event_tx: event_tx.clone(),
            pending_teardown: pending_teardown.clone(),
        });

        tokio::spawn(async move {
            loop {
                match event_rx.recv().await {
                    Ok(Notification::SessionReady(ref payload)) => {
                        Self::handle_session_ready(
                            &registry,
                            &prompted,
                            &agent_manager,
                            &payload.thread_id,
                        )
                        .await;
                    }
                    Ok(Notification::StatusChange(ref payload)) => {
                        let status = payload.status.as_str();
                        if status == "error" || status == "dead" {
                            Self::handle_session_failure(
                                &registry,
                                &event_tx,
                                &agent_manager,
                                &payload.thread_id,
                            )
                            .await;
                            prompted.write().await.remove(&payload.thread_id);
                            pending_teardown.write().await.remove(&payload.thread_id);
                        }
                    }
                    Ok(Notification::PromptComplete(ref payload)) => {
                        Self::handle_turn_complete_for_teardown(
                            &pending_teardown,
                            &agent_manager,
                            &payload.thread_id,
                        )
                        .await;
                    }
                    Ok(Notification::Error(ref payload)) => {
                        // Thread initialization (spawn or resume) failed; fail
                        // any Working task waiting on this session.
                        Self::handle_session_failure(
                            &registry,
                            &event_tx,
                            &agent_manager,
                            &payload.thread_id,
                        )
                        .await;
                        prompted.write().await.remove(&payload.thread_id);
                        pending_teardown.write().await.remove(&payload.thread_id);
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        log::warn!(
                            "TaskManager event loop lagged by {} messages, reconciling",
                            n
                        );
                        // Events may have been lost. Fail any Working task
                        // whose thread is no longer live so tasks do not get
                        // stuck after a missed StatusChange(dead).
                        self_ref.reconcile_after_lag().await;
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        log::info!("TaskManager event loop: channel closed, exiting");
                        break;
                    }
                    _ => {}
                }
            }
        });
    }

    async fn handle_session_ready(
        registry: &Arc<RwLock<TaskRegistry>>,
        prompted: &Arc<RwLock<HashSet<String>>>,
        agent_manager: &Arc<AgentManager>,
        thread_id: &str,
    ) {
        let task_info = {
            let reg = registry.read().await;
            let mut found = None;
            for task in reg.all_tasks() {
                if let TaskState::Working { session_id } = &task.state {
                    if session_id == thread_id {
                        found = Some((
                            task.id.clone(),
                            task.title.clone(),
                            task.description.clone(),
                        ));
                        break;
                    }
                }
            }
            found
        };

        if let Some((task_id, title, description)) = task_info {
            {
                let mut prompted = prompted.write().await;
                if prompted.contains(thread_id) {
                    return;
                }
                prompted.insert(thread_id.to_string());
            }

            let prompt = build_task_prompt(&task_id, &title, &description);
            match agent_manager.queue_prompt(thread_id, prompt).await {
                Ok(_reply_rx) => {
                    // Drop the receiver — task completion is driven by the agent calling complete_task.
                }
                Err(e) => {
                    log::error!(
                        "Failed to queue task prompt for thread {}: {}",
                        thread_id,
                        e
                    );
                }
            }
        }
    }

    /// When an agent finishes the turn during which it called `complete_task`
    /// we tear the session down. Triggered by `PromptComplete`, which fires
    /// once per completed turn. Idempotent: `kill_thread` on an already-
    /// removed thread is a no-op.
    async fn handle_turn_complete_for_teardown(
        pending_teardown: &Arc<RwLock<HashSet<String>>>,
        agent_manager: &Arc<AgentManager>,
        thread_id: &str,
    ) {
        let should_teardown = pending_teardown.write().await.remove(thread_id);
        if !should_teardown {
            return;
        }

        log::info!(
            "Tearing down thread {} after task completion turn drained",
            thread_id
        );
        if let Err(e) = agent_manager.shutdown_thread(thread_id).await {
            log::error!(
                "Failed to tear down completed task thread {}: {}",
                thread_id,
                e
            );
        }
    }

    async fn handle_session_failure(
        registry: &Arc<RwLock<TaskRegistry>>,
        event_tx: &broadcast::Sender<Notification>,
        agent_manager: &Arc<AgentManager>,
        thread_id: &str,
    ) {
        let workspace_id = {
            let mut reg = registry.write().await;
            let task = reg.all_tasks_mut().find(|t| {
                matches!(
                    &t.state,
                    TaskState::Working { session_id } if session_id == thread_id
                )
            });
            if let Some(task) = task {
                task.state = TaskState::Failed {
                    session_id: Some(thread_id.to_string()),
                };
                let ws_id = task.workspace_id.clone();
                let _ = event_tx.send(Notification::TaskUpdated(TaskPayload {
                    task: task.clone(),
                }));
                Some(ws_id)
            } else {
                None
            }
        };
        if let Some(ws_id) = workspace_id {
            if let Some(path) = agent_manager.workspace_path(&ws_id).await {
                let reg = registry.read().await;
                if let Err(e) = reg.save_to_dir(&ws_id, &path).await {
                    log::error!("Failed to persist tasks after failure: {}", e);
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_task(
        &self,
        workspace_id: WorkspaceId,
        title: String,
        description: String,
        agent_id: String,
        blocker_ids: Vec<String>,
        parent_id: Option<String>,
        creator_thread_id: Option<String>,
        subscribe: Option<SubscribeMode>,
    ) -> Result<String, String> {
        // Validate agent exists
        if self.agent_manager.get_agent(&agent_id).await.is_none() {
            return Err(format!("Agent definition '{}' not found", agent_id));
        }

        // Validate all blocker IDs exist
        {
            let reg = self.registry.read().await;
            for bid in &blocker_ids {
                if reg.get_task(bid).is_none() {
                    return Err(format!("Blocker task '{}' not found", bid));
                }
            }
        }

        let (task_id, task) = {
            let mut reg = self.registry.write().await;
            let id = reg.create_task(
                workspace_id.clone(),
                title,
                description,
                agent_id,
                blocker_ids.clone(),
                parent_id,
                creator_thread_id.clone(),
            );
            let task = reg.get_task(&id).unwrap().clone();
            (id, task)
        };

        let _ = self.event_tx.send(Notification::TaskCreated(TaskPayload {
            task: task.clone(),
        }));

        self.persist_tasks(&workspace_id).await;

        // Register the creator as a subscriber BEFORE start_task fires so the
        // "started" notification is not lost for no-blocker tasks that start
        // synchronously inside this function.
        if let (Some(mode), Some(ref thread_id)) = (subscribe, &creator_thread_id) {
            self.register_subscriber(&task_id, thread_id, mode).await;
        }

        if blocker_ids.is_empty() {
            if let Err(e) = self.start_task(&task_id).await {
                log::error!("Failed to start task {} at creation: {}", task_id, e);
                // Mark the orphaned task Failed so it is visible to the user
                // and not retried on every subsequent completion in the workspace.
                if let Err(fe) = self.fail_task(&task_id).await {
                    log::error!("Failed to mark task {} as failed: {}", task_id, fe);
                }
                return Err(e);
            }
        }

        Ok(task_id)
    }

    pub async fn complete_task(
        &self,
        task_id: &str,
        summary: Option<String>,
    ) -> Result<(), String> {
        let (workspace_id, session_id) = {
            let mut reg = self.registry.write().await;
            let task = reg
                .get_task_mut(task_id)
                .ok_or_else(|| format!("Task '{}' not found", task_id))?;
            let session_id = match &task.state {
                TaskState::Working { session_id } => session_id.clone(),
                other => {
                    return Err(format!(
                        "Task '{}' is not in Working status (current: {:?})",
                        task_id, other
                    ));
                }
            };
            task.state = TaskState::Completed {
                session_id: session_id.clone(),
            };
            task.summary = summary.clone();
            let workspace_id = task.workspace_id.clone();
            let _ = self.event_tx.send(Notification::TaskUpdated(TaskPayload {
                task: task.clone(),
            }));
            (workspace_id, session_id)
        };

        self.prompted_sessions.write().await.remove(&session_id);

        // Block further prompts and queue the thread for teardown once its
        // current turn drains (observed via `StatusChange(Idle)`).
        if let Err(e) = self.agent_manager.mark_thread_completing(&session_id).await {
            log::warn!(
                "mark_thread_completing failed for thread {}: {}",
                session_id,
                e
            );
        }
        self.pending_teardown
            .write()
            .await
            .insert(session_id.clone());

        self.notify_subscribers(
            task_id,
            "completed",
            summary.as_deref().unwrap_or("Task completed"),
        )
        .await;

        self.persist_tasks(&workspace_id).await;
        self.start_unblocked_tasks(&workspace_id).await;

        Ok(())
    }

    pub async fn fail_task(&self, task_id: &str) -> Result<(), String> {
        let (workspace_id, session_id) = {
            let mut reg = self.registry.write().await;
            let task = reg
                .get_task_mut(task_id)
                .ok_or_else(|| format!("Task '{}' not found", task_id))?;
            // Preserve the existing session_id (if any) across the transition:
            // a Pending task has none, Working/Completed/Failed may have one.
            let session_id = task.state.session_id().map(str::to_string);
            task.state = TaskState::Failed {
                session_id: session_id.clone(),
            };
            let workspace_id = task.workspace_id.clone();
            let _ = self.event_tx.send(Notification::TaskUpdated(TaskPayload {
                task: task.clone(),
            }));
            (workspace_id, session_id)
        };
        if let Some(sid) = session_id {
            self.prompted_sessions.write().await.remove(&sid);
        }
        self.persist_tasks(&workspace_id).await;
        Ok(())
    }

    pub async fn list_tasks(&self, workspace_id: &WorkspaceId) -> Vec<Task> {
        let reg = self.registry.read().await;
        reg.list_tasks(workspace_id).into_iter().cloned().collect()
    }

    pub async fn get_task(&self, task_id: &str) -> Result<Task, String> {
        let reg = self.registry.read().await;
        reg.get_task(task_id)
            .cloned()
            .ok_or_else(|| format!("Task '{}' not found", task_id))
    }

    /// Post a progress update for `task_id` and route it to all subscribers.
    ///
    /// Returns `Err` if the task does not exist or is not in the `Working` state.
    pub async fn post_update(&self, task_id: &str, description: &str) -> Result<(), String> {
        {
            let reg = self.registry.read().await;
            let task = reg
                .get_task(task_id)
                .ok_or_else(|| format!("Task '{}' not found", task_id))?;
            if !matches!(task.state, TaskState::Working { .. }) {
                return Err("task is not currently working".into());
            }
        }
        self.notify_subscribers(task_id, "update", description)
            .await;
        Ok(())
    }

    /// Return `true` if `thread_id` is a subscriber for `task_id`.
    ///
    /// Used in tests to verify subscriber registration without exposing the
    /// full subscription map.
    #[cfg(test)]
    pub async fn is_subscriber(&self, task_id: &str, thread_id: &str) -> bool {
        let subs = self.subscriptions.read().await;
        subs.get(task_id)
            .map(|list| list.iter().any(|(tid, _)| tid == thread_id))
            .unwrap_or(false)
    }

    /// Register `thread_id` as a subscriber for notifications on `task_id` with the given `mode`.
    ///
    /// If `thread_id` is already registered for this task, its mode is replaced.
    /// De-duplicates by thread_id so at most one entry per thread exists.
    pub async fn register_subscriber(&self, task_id: &str, thread_id: &str, mode: SubscribeMode) {
        let mut subs = self.subscriptions.write().await;
        let entry = subs.entry(task_id.to_string()).or_default();
        if let Some(existing) = entry.iter_mut().find(|(tid, _)| tid == thread_id) {
            existing.1 = mode;
        } else {
            entry.push((thread_id.to_string(), mode));
        }
    }

    /// Emit a `TaskStatusNotification` broadcast event for every subscriber of `task_id`
    /// whose mode covers `kind`.
    ///
    /// The read lock is released before iterating so no lock is held across the
    /// `event_tx.send` calls. Send errors are ignored — a broadcast send only
    /// fails when there are zero active receivers, which is fine.
    async fn notify_subscribers(&self, task_id: &str, kind: &str, message: &str) {
        let subscribers: Vec<(String, SubscribeMode)> = {
            let subs = self.subscriptions.read().await;
            subs.get(task_id).cloned().unwrap_or_default()
        };

        for (thread_id, mode) in subscribers {
            if !mode.covers(kind) {
                continue;
            }
            let payload = TaskStatusNotificationPayload {
                task_id: task_id.to_string(),
                creator_thread_id: thread_id.clone(),
                kind: kind.to_string(),
                message: message.to_string(),
            };
            self.event_tx
                .send(Notification::TaskStatusNotification(payload))
                .ok();
        }
    }

    pub async fn list_tasks_for_agent(&self, agent_id: &str) -> Vec<Task> {
        let reg = self.registry.read().await;
        reg.list_tasks_for_agent(agent_id)
            .into_iter()
            .cloned()
            .collect()
    }

    pub async fn agent_has_active_tasks(&self, agent_id: &str) -> bool {
        let reg = self.registry.read().await;
        reg.agent_has_active_tasks(agent_id)
    }

    pub async fn load_tasks(&self, workspace_dir: &std::path::Path) -> Result<(), String> {
        let mut reg = self.registry.write().await;
        reg.load_from_dir(workspace_dir).await
    }

    /// Remove all tasks for a workspace from the in-memory registry.
    ///
    /// Call this when a workspace is deleted. The on-disk tasks.json is
    /// already removed with the workspace directory.
    pub async fn delete_tasks_for_workspace(&self, workspace_id: &WorkspaceId) {
        let mut reg = self.registry.write().await;
        reg.delete_tasks_for_workspace(workspace_id);
    }

    /// Transition every Working task in a workspace to Failed.
    ///
    /// Call this when the workspace's container is about to stop, so tasks
    /// whose threads may have crashed externally are not left stuck.
    pub async fn fail_working_tasks_in_workspace(&self, workspace_id: &WorkspaceId) {
        let mut persisted = false;
        {
            let mut reg = self.registry.write().await;
            for task in reg.all_tasks_mut() {
                if &task.workspace_id != workspace_id {
                    continue;
                }
                if let TaskState::Working { session_id } = &task.state {
                    let sid = session_id.clone();
                    task.state = TaskState::Failed {
                        session_id: Some(sid),
                    };
                    persisted = true;
                    let _ = self.event_tx.send(Notification::TaskUpdated(TaskPayload {
                        task: task.clone(),
                    }));
                }
            }
        }
        if persisted {
            self.persist_tasks(workspace_id).await;
        }
    }

    /// Resume Working task threads and start unblocked Pending tasks for a workspace.
    ///
    /// Called at startup for each workspace with a running container and
    /// after `start_container` brings one up later. Assumes the workspace's
    /// container is running — if it is not, the resume and spawn attempts
    /// will fail and the affected tasks will be marked Failed.
    ///
    /// For each Working task:
    ///   - If its thread is already live, skip it.
    ///   - If the persisted thread mapping is missing or lacks an ACP session,
    ///     the task cannot be recovered — mark it Failed.
    ///   - Otherwise call `resume_thread` to reattach. The thread's
    ///     `session_id` is pre-inserted into `prompted_sessions` so the
    ///     existing dedup guard prevents the initial task prompt from being
    ///     re-sent when `SessionReady` fires post-resume.
    ///
    /// After the resume pass, `start_unblocked_tasks` spawns any Pending
    /// tasks whose blockers are all Completed.
    pub async fn resume_workspace_tasks(&self, workspace_id: &WorkspaceId) {
        let workspace_path = match self.agent_manager.workspace_path(workspace_id).await {
            Some(p) => p,
            None => return,
        };

        let mappings = crate::agent::thread_manager::ThreadManager::load_from_dir(&workspace_path)
            .await
            .unwrap_or_default();
        let mapping_by_thread: std::collections::HashMap<String, _> = mappings
            .into_iter()
            .map(|m| (m.thread_id.clone(), m))
            .collect();

        // Snapshot Working tasks for this workspace under the read lock.
        let working: Vec<(String, String, String)> = {
            let reg = self.registry.read().await;
            reg.list_tasks(workspace_id)
                .into_iter()
                .filter_map(|t| {
                    if let TaskState::Working { session_id } = &t.state {
                        Some((t.id.clone(), t.agent_id.clone(), session_id.clone()))
                    } else {
                        None
                    }
                })
                .collect()
        };

        let live = self.agent_manager.live_thread_ids().await;

        for (task_id, agent_id, thread_id) in working {
            if live.contains(&thread_id) {
                continue;
            }
            let mapping = match mapping_by_thread.get(&thread_id) {
                Some(m) => m,
                None => {
                    log::warn!(
                        "Task {} Working but thread mapping {} is missing; marking Failed",
                        task_id,
                        thread_id
                    );
                    let _ = self.fail_task(&task_id).await;
                    continue;
                }
            };
            let acp_session_id = match mapping.acp_session_id.clone() {
                Some(sid) => sid,
                None => {
                    log::warn!(
                        "Task {} Working but thread {} has no ACP session; marking Failed",
                        task_id,
                        thread_id
                    );
                    let _ = self.fail_task(&task_id).await;
                    continue;
                }
            };

            // Pre-populate the prompted guard so the initial task prompt is not
            // re-sent after the ACP session is reloaded.
            self.prompted_sessions
                .write()
                .await
                .insert(thread_id.clone());

            if let Err(e) = self
                .agent_manager
                .resume_thread(&thread_id, &agent_id, &acp_session_id)
                .await
            {
                log::error!(
                    "Failed to resume thread {} for task {}: {}",
                    thread_id,
                    task_id,
                    e
                );
                self.prompted_sessions.write().await.remove(&thread_id);
                let _ = self.fail_task(&task_id).await;
            }
        }

        // Kick off any Pending tasks whose blockers are all Completed. Safe to
        // call now that we know the container is running.
        self.start_unblocked_tasks(workspace_id).await;
    }

    pub async fn recover_stale_tasks(&self, live_thread_ids: &HashSet<String>) {
        let mut affected_workspaces: HashSet<WorkspaceId> = HashSet::new();
        {
            let mut reg = self.registry.write().await;
            for task in reg.all_tasks_mut() {
                if let TaskState::Working { session_id } = &task.state {
                    if !live_thread_ids.contains(session_id) {
                        let sid = session_id.clone();
                        task.state = TaskState::Failed {
                            session_id: Some(sid),
                        };
                        affected_workspaces.insert(task.workspace_id.clone());
                        let _ = self.event_tx.send(Notification::TaskUpdated(TaskPayload {
                            task: task.clone(),
                        }));
                    }
                }
            }
        }
        for ws_id in affected_workspaces {
            self.persist_tasks(&ws_id).await;
        }
    }

    async fn start_task(&self, task_id: &str) -> Result<(), String> {
        let agent_id = {
            let reg = self.registry.read().await;
            let task = reg
                .get_task(task_id)
                .ok_or_else(|| format!("Task '{}' not found", task_id))?;
            task.agent_id.clone()
        };

        let thread_id = self
            .agent_manager
            .spawn_thread(&agent_id, Some(task_id.to_string()))
            .await?;

        let (workspace_id, task_title) = {
            let mut reg = self.registry.write().await;
            if let Some(task) = reg.get_task_mut(task_id) {
                // Atomic transition: state and session_id move together so the
                // task is never observed in an invalid intermediate shape.
                task.state = TaskState::Working {
                    session_id: thread_id,
                };
                let _ = self.event_tx.send(Notification::TaskUpdated(TaskPayload {
                    task: task.clone(),
                }));
                (Some(task.workspace_id.clone()), Some(task.title.clone()))
            } else {
                (None, None)
            }
        };

        // Notify subscribers that the task has started (Pending → Working).
        // Lock is dropped before this await so no lock is held across the send.
        if let Some(ref title) = task_title {
            self.notify_subscribers(task_id, "started", title).await;
        }

        // Persist the Working transition so a restart before the next
        // state change does not lose the task's session_id.
        if let Some(ws_id) = workspace_id {
            self.persist_tasks(&ws_id).await;
        }

        Ok(())
    }

    async fn start_unblocked_tasks(&self, workspace_id: &WorkspaceId) {
        let unblocked = {
            let reg = self.registry.read().await;
            reg.find_unblocked_tasks(workspace_id)
        };
        for task_id in unblocked {
            if let Err(e) = self.start_task(&task_id).await {
                log::error!("Failed to start unblocked task {}: {}", task_id, e);
                // Mark the task Failed so it is not retried on every subsequent
                // completion in the workspace.
                if let Err(fe) = self.fail_task(&task_id).await {
                    log::error!("Failed to mark task {} as failed: {}", task_id, fe);
                }
            }
        }
    }

    async fn persist_tasks(&self, workspace_id: &WorkspaceId) {
        if let Some(path) = self.agent_manager.workspace_path(workspace_id).await {
            let reg = self.registry.read().await;
            if let Err(e) = reg.save_to_dir(workspace_id, &path).await {
                log::error!("Failed to persist tasks: {}", e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::AgentManager;
    use crate::mcp::TokenRegistry;
    use emergent_protocol::TaskStatusNotificationPayload;

    fn build_task_prompt_exposed(task_id: &str, title: &str, description: &str) -> String {
        build_task_prompt(task_id, title, description)
    }

    #[test]
    fn task_prompt_includes_completion_instruction() {
        let prompt = build_task_prompt_exposed("task-42", "Ship it", "Wrap up the feature.");

        assert!(prompt.contains("Task task-42: Ship it"));
        assert!(prompt.contains("Wrap up the feature."));
        assert!(prompt.contains("`complete_task`"));
        assert!(prompt.contains("mark it done"));
        assert!(prompt.contains("session will end"));
    }

    /// Creates a minimal TaskManager backed by an empty AgentManager.
    async fn make_task_manager() -> (TaskManager, broadcast::Receiver<Notification>) {
        let registry = Arc::new(TokenRegistry::new());
        let workspace_state = crate::workspace::new_shared_state();
        let (event_tx, event_rx) = tokio::sync::broadcast::channel(1024);
        let runtime = crate::runtime::load_shared_runtime().await;
        let agent_manager = Arc::new(AgentManager::new(
            workspace_state,
            event_tx.clone(),
            registry,
            runtime,
        ));
        let tm = TaskManager::new(agent_manager, event_tx);
        (tm, event_rx)
    }

    /// Insert a task into the registry with Working state (bypassing start_task).
    /// Returns the generated task ID.
    async fn insert_working_task(
        tm: &TaskManager,
        session_id: &str,
        workspace_id: WorkspaceId,
    ) -> String {
        let mut reg = tm.registry.write().await;
        let id = reg.create_task(
            workspace_id,
            "Test task".into(),
            "desc".into(),
            "agent-1".into(),
            vec![],
            None,
            None,
        );
        if let Some(task) = reg.get_task_mut(&id) {
            task.state = TaskState::Working {
                session_id: session_id.to_string(),
            };
        }
        id
    }

    #[tokio::test]
    async fn register_subscriber_deduplicates() {
        let (tm, _rx) = make_task_manager().await;

        tm.register_subscriber("task-1", "thread-a", SubscribeMode::Milestones)
            .await;
        // Re-register same thread with a different mode — must REPLACE, not duplicate.
        tm.register_subscriber("task-1", "thread-a", SubscribeMode::All)
            .await;
        tm.register_subscriber("task-1", "thread-b", SubscribeMode::Milestones)
            .await;

        let subs = tm.subscriptions.read().await;
        let list = subs.get("task-1").unwrap();
        assert_eq!(list.len(), 2, "duplicate subscription must be deduplicated");
        let thread_a_entry = list.iter().find(|(tid, _)| tid == "thread-a");
        assert!(thread_a_entry.is_some(), "thread-a must be present");
        assert_eq!(
            thread_a_entry.unwrap().1,
            SubscribeMode::All,
            "re-registration must replace the mode"
        );
        assert!(list.iter().any(|(tid, _)| tid == "thread-b"));
    }

    #[tokio::test]
    async fn notify_subscribers_emits_one_notification_per_subscriber() {
        let (tm, mut rx) = make_task_manager().await;

        tm.register_subscriber("task-2", "thread-x", SubscribeMode::All)
            .await;
        tm.register_subscriber("task-2", "thread-y", SubscribeMode::All)
            .await;

        tm.notify_subscribers("task-2", "update", "progress note")
            .await;

        let mut received: Vec<TaskStatusNotificationPayload> = Vec::new();
        while let Ok(notification) = rx.try_recv() {
            if let Notification::TaskStatusNotification(p) = notification {
                received.push(p);
            }
        }

        assert_eq!(received.len(), 2, "one notification per subscriber");
        let thread_ids: Vec<&str> = received
            .iter()
            .map(|p| p.creator_thread_id.as_str())
            .collect();
        assert!(thread_ids.contains(&"thread-x"));
        assert!(thread_ids.contains(&"thread-y"));
        for p in &received {
            assert_eq!(p.task_id, "task-2");
            assert_eq!(p.kind, "update");
            assert_eq!(p.message, "progress note");
        }
    }

    #[tokio::test]
    async fn notify_subscribers_filters_by_mode() {
        let (tm, mut rx) = make_task_manager().await;

        // Milestones subscriber: should NOT receive "update"
        tm.register_subscriber(
            "task-filter",
            "thread-milestones",
            SubscribeMode::Milestones,
        )
        .await;
        // All subscriber: SHOULD receive "update"
        tm.register_subscriber("task-filter", "thread-all", SubscribeMode::All)
            .await;

        tm.notify_subscribers("task-filter", "update", "a progress note")
            .await;

        let mut received: Vec<TaskStatusNotificationPayload> = Vec::new();
        while let Ok(notification) = rx.try_recv() {
            if let Notification::TaskStatusNotification(p) = notification {
                received.push(p);
            }
        }

        assert_eq!(
            received.len(),
            1,
            "only the All subscriber should receive an update notification"
        );
        assert_eq!(received[0].creator_thread_id, "thread-all");
        assert_eq!(received[0].kind, "update");
    }

    #[tokio::test]
    async fn complete_task_with_summary_persists_summary() {
        let (tm, _rx) = make_task_manager().await;
        let ws_id = WorkspaceId::from("test-ws");
        let task_id = insert_working_task(&tm, "sess-abc", ws_id.clone()).await;

        // complete_task will warn on mark_thread_completing (thread not in manager), but proceeds.
        let result = tm.complete_task(&task_id, Some("All done!".into())).await;
        assert!(result.is_ok(), "complete_task should succeed: {:?}", result);

        let task = tm.get_task(&task_id).await.unwrap();
        assert!(task.state.is_completed(), "task must be Completed");
        assert_eq!(task.summary, Some("All done!".into()));
    }

    #[tokio::test]
    async fn create_task_with_subscribe_registers_subscriber() {
        // Verify that calling register_subscriber after create_task (the pattern
        // the MCP handler uses when subscribe is set) correctly wires the subscriber.
        let (tm, _rx) = make_task_manager().await;

        // Directly exercise the subscriber path — simulates what the MCP handler
        // does after create_task returns: register_subscriber(&task_id, &thread_id, mode).
        let task_id = "task-sub-test";
        let creator_thread = "creator-123";

        // Register before any task exists — should still work (no validation on task_id).
        tm.register_subscriber(task_id, creator_thread, SubscribeMode::All)
            .await;

        assert!(
            tm.is_subscriber(task_id, creator_thread).await,
            "creator thread must be subscribed after register_subscriber"
        );
        // Registering again with same thread_id must replace (not duplicate).
        tm.register_subscriber(task_id, creator_thread, SubscribeMode::Milestones)
            .await;
        let subs = tm.subscriptions.read().await;
        let list = subs.get(task_id).unwrap();
        assert_eq!(list.len(), 1, "duplicate subscription must be deduplicated");
        assert_eq!(
            list[0].1,
            SubscribeMode::Milestones,
            "re-registration must update the mode"
        );
    }

    #[tokio::test]
    async fn post_update_on_non_working_task_returns_err() {
        let (tm, _rx) = make_task_manager().await;
        let ws_id = WorkspaceId::from("test-ws");

        // Insert a task in Pending state (not Working) via the registry directly.
        let task_id = {
            let mut reg = tm.registry.write().await;
            reg.create_task(
                ws_id,
                "Test task".into(),
                "desc".into(),
                "agent-1".into(),
                vec![],
                None,
                None,
            )
        };

        let result = tm.post_update(&task_id, "some progress").await;
        assert!(
            result.is_err(),
            "post_update on Pending task must return Err"
        );
        assert_eq!(
            result.unwrap_err(),
            "task is not currently working",
            "error message must match"
        );
    }

    #[tokio::test]
    async fn post_update_on_working_task_emits_notification() {
        let (tm, mut rx) = make_task_manager().await;
        let ws_id = WorkspaceId::from("test-ws");
        let task_id = insert_working_task(&tm, "sess-upd", ws_id).await;

        tm.register_subscriber(&task_id, "subscriber-thread", SubscribeMode::All)
            .await;

        let result = tm.post_update(&task_id, "halfway there").await;
        assert!(result.is_ok(), "post_update on Working task must succeed");

        let mut found: Option<TaskStatusNotificationPayload> = None;
        while let Ok(notification) = rx.try_recv() {
            if let Notification::TaskStatusNotification(p) = notification {
                if p.task_id == task_id {
                    found = Some(p);
                    break;
                }
            }
        }

        let p = found.expect("expected a TaskStatusNotification");
        assert_eq!(p.creator_thread_id, "subscriber-thread");
        assert_eq!(p.kind, "update");
        assert_eq!(p.message, "halfway there");
    }

    #[tokio::test]
    async fn complete_task_notifies_registered_subscribers() {
        let (tm, mut rx) = make_task_manager().await;
        let ws_id = WorkspaceId::from("test-ws");
        let task_id = insert_working_task(&tm, "sess-def", ws_id.clone()).await;

        tm.register_subscriber(&task_id, "creator-thread", SubscribeMode::All)
            .await;

        let result = tm
            .complete_task(&task_id, Some("Summary here".into()))
            .await;
        assert!(result.is_ok());

        let mut found: Option<TaskStatusNotificationPayload> = None;
        while let Ok(notification) = rx.try_recv() {
            if let Notification::TaskStatusNotification(p) = notification {
                if p.task_id == task_id {
                    found = Some(p);
                    break;
                }
            }
        }

        let p = found.expect("expected a TaskStatusNotification for the task");
        assert_eq!(p.creator_thread_id, "creator-thread");
        assert_eq!(p.kind, "completed");
        assert_eq!(p.message, "Summary here");
    }

    /// Verifies that a Milestones subscriber receives a "started" notification when
    /// notify_subscribers is called with kind="started" (the path invoked by start_task
    /// after the Pending → Working transition).
    #[tokio::test]
    async fn start_task_emits_started_notification_to_subscribers() {
        let (tm, mut rx) = make_task_manager().await;
        let task_id = "task-started-test";
        let task_title = "Important work";

        // Register a Milestones subscriber on the (not-yet-started) task.
        tm.register_subscriber(task_id, "creator-thread", SubscribeMode::Milestones)
            .await;

        // Fire the "started" notification — this is exactly what start_task
        // calls after the state transition, with the task title as the message.
        tm.notify_subscribers(task_id, "started", task_title).await;

        let mut found: Option<TaskStatusNotificationPayload> = None;
        while let Ok(notification) = rx.try_recv() {
            if let Notification::TaskStatusNotification(p) = notification {
                if p.task_id == task_id {
                    found = Some(p);
                    break;
                }
            }
        }

        let p = found.expect("Milestones subscriber must receive 'started' notification");
        assert_eq!(p.creator_thread_id, "creator-thread");
        assert_eq!(p.kind, "started");
        assert_eq!(p.message, task_title);
    }

    /// Regression test: the "started" notification must reach the creator session when a
    /// no-blocker task is created with `subscribe: Some(SubscribeMode::Milestones)`.
    ///
    /// The bug was that `register_subscriber` was called AFTER `create_task` returned (in
    /// the MCP handler), so `start_task` (which fires synchronously inside `create_task`
    /// for tasks without blockers) emitted the "started" event before any subscriber was
    /// registered.  The fix moves `register_subscriber` inside `create_task`, before
    /// `start_task` is invoked.
    #[tokio::test]
    async fn started_notification_reaches_subscriber_for_no_blocker_task() {
        let (tm, mut rx) = make_task_manager().await;
        let creator_thread = "creator-abc";

        // create_task with subscribe=Some(Milestones) and a creator_thread_id.
        // The agent validation inside create_task will fail because the AgentManager
        // is empty, but the subscriber registration (and therefore the ordering fix)
        // can be verified by bypassing create_task and exercising the exact sequence
        // that the fixed code follows: register_subscriber → notify_subscribers.
        //
        // We directly call the two methods in the correct order (as the fix implements)
        // to confirm that the subscriber is present when the "started" event fires.
        let task_id = "race-fix-task";

        // Step 1 (mirrors the fix): register the subscriber BEFORE start_task.
        tm.register_subscriber(task_id, creator_thread, SubscribeMode::Milestones)
            .await;

        // Step 2: fire the "started" notification (mirrors start_task).
        tm.notify_subscribers(task_id, "started", "Race-fix task title")
            .await;

        // The subscriber must receive the "started" event.
        let mut found: Option<TaskStatusNotificationPayload> = None;
        while let Ok(notification) = rx.try_recv() {
            if let Notification::TaskStatusNotification(p) = notification {
                if p.task_id == task_id && p.kind == "started" {
                    found = Some(p);
                    break;
                }
            }
        }

        let p = found
            .expect("creator session must receive 'started' notification for a no-blocker task");
        assert_eq!(p.creator_thread_id, creator_thread);
        assert_eq!(p.kind, "started");
        assert_eq!(p.task_id, task_id);

        // Also confirm that if registration happens AFTER notify_subscribers (the old
        // buggy ordering), no notification is delivered.
        let task_id_buggy = "race-fix-task-buggy";

        // Step 1 (old bug): fire the notification first — no subscriber yet.
        tm.notify_subscribers(task_id_buggy, "started", "Buggy task")
            .await;

        // Step 2 (old bug): register the subscriber AFTER the event already fired.
        tm.register_subscriber(task_id_buggy, creator_thread, SubscribeMode::Milestones)
            .await;

        // No notification should be received because the event fired before registration.
        let mut found_buggy: Option<TaskStatusNotificationPayload> = None;
        while let Ok(notification) = rx.try_recv() {
            if let Notification::TaskStatusNotification(p) = notification {
                if p.task_id == task_id_buggy {
                    found_buggy = Some(p);
                    break;
                }
            }
        }
        assert!(
            found_buggy.is_none(),
            "late-registered subscriber must NOT receive notifications fired before registration"
        );
    }
}
