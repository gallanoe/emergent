pub mod registry;

use std::collections::HashSet;
use std::sync::Arc;

use emergent_protocol::{Notification, Task, TaskPayload, TaskState, WorkspaceId};
use tokio::sync::{broadcast, RwLock};

use crate::agent::AgentManager;
use registry::TaskRegistry;

pub struct TaskManager {
    registry: Arc<RwLock<TaskRegistry>>,
    agent_manager: Arc<AgentManager>,
    event_tx: broadcast::Sender<Notification>,
    prompted_sessions: Arc<RwLock<HashSet<String>>>,
}

/// Lightweight clone of TaskManager fields needed inside the spawned event
/// loop for reconciliation on broadcast lag.
struct TaskManagerRef {
    registry: Arc<RwLock<TaskRegistry>>,
    agent_manager: Arc<AgentManager>,
    event_tx: broadcast::Sender<Notification>,
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
        }
    }

    pub fn start_event_loop(&self, mut event_rx: broadcast::Receiver<Notification>) {
        let registry = self.registry.clone();
        let prompted = self.prompted_sessions.clone();
        let agent_manager = self.agent_manager.clone();
        let event_tx = self.event_tx.clone();
        let self_ref = Arc::new(TaskManagerRef {
            registry: registry.clone(),
            agent_manager: agent_manager.clone(),
            event_tx: event_tx.clone(),
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
                        }
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
                        found =
                            Some((task.id.clone(), task.title.clone(), task.description.clone()));
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

            let prompt = format!("Task {}: {}\n\n{}", task_id, title, description);
            match agent_manager.queue_prompt(thread_id, prompt, None).await {
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

    pub async fn create_task(
        &self,
        workspace_id: WorkspaceId,
        title: String,
        description: String,
        agent_id: String,
        blocker_ids: Vec<String>,
        parent_id: Option<String>,
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
            );
            let task = reg.get_task(&id).unwrap().clone();
            (id, task)
        };

        let _ = self.event_tx.send(Notification::TaskCreated(TaskPayload {
            task: task.clone(),
        }));

        self.persist_tasks(&workspace_id).await;

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

    pub async fn complete_task(&self, task_id: &str) -> Result<(), String> {
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
            let workspace_id = task.workspace_id.clone();
            let _ = self.event_tx.send(Notification::TaskUpdated(TaskPayload {
                task: task.clone(),
            }));
            (workspace_id, session_id)
        };

        self.prompted_sessions.write().await.remove(&session_id);

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

        {
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
            }
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
