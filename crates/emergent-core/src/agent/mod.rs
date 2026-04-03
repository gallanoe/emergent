mod acp_bridge;
mod lifecycle;
mod prompt_loop;
pub mod registry;
pub mod spawner;

pub use registry::AgentRegistry;
pub use spawner::{AgentProcess, DockerCliSpawner, ProcessSpawner};

use std::collections::HashMap;
use std::sync::Arc;

use emergent_protocol::{
    AgentErrorPayload, AgentStatus, AgentSummary, ConfigOption, ConfigUpdatePayload, Notification,
    StatusChangePayload, SwarmMessagePayload, WorkspaceId,
};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex, RwLock};

use crate::swarm::{Mailbox, MailboxMessage};

// ---------------------------------------------------------------------------
// Commands sent to the dedicated ACP thread
// ---------------------------------------------------------------------------

pub(crate) enum AgentCommand {
    Prompt {
        text: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Cancel {
        reply: oneshot::Sender<Result<(), String>>,
    },
    SetConfig {
        config_id: String,
        value: String,
        reply: oneshot::Sender<Result<Vec<ConfigOption>, String>>,
    },
    Shutdown,
}

// ---------------------------------------------------------------------------
// AgentHandle — the Send-safe handle stored in the manager map
// ---------------------------------------------------------------------------

pub(crate) struct AgentHandle {
    pub(crate) status: AgentStatus,
    pub(crate) cli: String,
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) command_tx: mpsc::UnboundedSender<AgentCommand>,
    /// Handle to the OS-level child process (for kill).
    pub(crate) child: tokio::process::Child,
    /// Handle to the dedicated ACP thread (kept for ownership; not joined).
    pub(crate) thread_handle: Option<std::thread::JoinHandle<()>>,
    pub(crate) config_options: Vec<ConfigOption>,
    pub(crate) has_management_permissions: bool,
    /// Whether the agent has received at least one prompt (gates first-turn injection).
    pub(crate) has_prompted: bool,
    /// Optional role for this agent. Set at spawn (MCP) or first prompt (user).
    pub(crate) role: Option<String>,
    /// Permission state at time of last prompt — used to detect changes.
    pub(crate) last_prompted_permissions: bool,
    /// Wakes the prompt loop when work is available (user prompt or mailbox message).
    pub(crate) prompt_notify: Arc<tokio::sync::Notify>,
    /// Queued user prompt + reply channel. At most one pending at a time.
    pub(crate) pending_prompt: Option<(String, oneshot::Sender<Result<(), String>>)>,
    /// Handle to the prompt loop task (aborted on kill).
    pub(crate) prompt_loop_handle: Option<tokio::task::JoinHandle<()>>,
}

// ---------------------------------------------------------------------------
// AgentManager
// ---------------------------------------------------------------------------

pub struct AgentManager {
    agents: Arc<RwLock<HashMap<String, Arc<Mutex<AgentHandle>>>>>,
    event_tx: broadcast::Sender<Notification>,
    history: Arc<RwLock<HashMap<String, Vec<Notification>>>>,
    mailboxes: Arc<RwLock<HashMap<String, Mailbox>>>,
    topology: Arc<RwLock<crate::swarm::Topology>>,
    mcp_port: std::sync::atomic::AtomicU16,
    token_registry: Arc<crate::mcp::TokenRegistry>,
    workspace_state: crate::workspace::SharedWorkspaceState,
}

impl AgentManager {
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

    pub fn new(
        workspace_state: crate::workspace::SharedWorkspaceState,
        event_tx: broadcast::Sender<Notification>,
        token_registry: Arc<crate::mcp::TokenRegistry>,
    ) -> Self {
        enrich_path();
        let history: Arc<RwLock<HashMap<String, Vec<Notification>>>> =
            Arc::new(RwLock::new(HashMap::new()));

        // Spawn background task to record all notifications into per-agent history
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
            agents: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
            history,
            mailboxes: Arc::new(RwLock::new(HashMap::new())),
            topology: Arc::new(RwLock::new(crate::swarm::Topology::new())),
            mcp_port: std::sync::atomic::AtomicU16::new(0),
            token_registry,
            workspace_state,
        }
    }

    /// Set the MCP HTTP server port (called after HTTP server binds).
    pub fn set_mcp_port(&self, port: u16) {
        self.mcp_port
            .store(port, std::sync::atomic::Ordering::Relaxed);
    }

    /// Spawn an agent subprocess asynchronously.
    ///
    /// Returns the agent ID immediately. The ACP handshake runs in a background
    /// task and emits `StatusChange(Idle)` or `Error` notifications on completion.
    pub async fn spawn_agent(
        &self,
        workspace_id: WorkspaceId,
        agent_binary: String,
        role: Option<String>,
    ) -> Result<String, String> {
        // Read workspace state to get the container_id
        let container_id = {
            let state = self.workspace_state.read().await;
            let ws = state
                .workspaces
                .get(&workspace_id)
                .ok_or_else(|| format!("Workspace '{}' not found", workspace_id))?;
            match &ws.container_status {
                emergent_protocol::ContainerStatus::Running => {}
                other => {
                    return Err(format!(
                        "Workspace '{}' container is not running (status: {})",
                        workspace_id, other
                    ));
                }
            }
            ws.container_id
                .clone()
                .ok_or_else(|| format!("Workspace '{}' has no container_id", workspace_id))?
        };

        let agent_id = Self::generate_short_id();

        log::info!(
            "Spawning agent {} (cli: {}, workspace: {}, container: {})",
            &agent_id,
            agent_binary,
            workspace_id,
            container_id
        );

        // Return ID immediately — the frontend sets "initializing" status locally.
        // Initialization (process spawn + ACP handshake) runs asynchronously.
        let agents = self.agents.clone();
        let event_tx = self.event_tx.clone();
        let history = self.history.clone();
        let mailboxes = self.mailboxes.clone();
        let id = agent_id.clone();

        let bearer_token = self.token_registry.register(&id);
        let mcp_port = self
            .mcp_port
            .load(std::sync::atomic::Ordering::Relaxed);
        let role_clone = role.clone();

        tokio::spawn(async move {
            match lifecycle::initialize_agent(
                id.clone(),
                workspace_id,
                container_id,
                agent_binary,
                role_clone,
                agents,
                event_tx.clone(),
                history,
                mailboxes,
                mcp_port,
                bearer_token,
            )
            .await
            {
                Ok(()) => {
                    log::info!("Agent {} spawned successfully", &id);
                }
                Err(e) => {
                    log::error!("Agent {} failed to initialize: {}", &id, e);
                    let _ = event_tx.send(Notification::Error(AgentErrorPayload {
                        agent_id: id,
                        message: e,
                    }));
                }
            }
        });

        Ok(agent_id)
    }

    /// Queue a user prompt for an agent. The prompt loop will pick it up.
    /// Returns a receiver that resolves when the prompt completes.
    pub async fn queue_prompt(
        &self,
        agent_id: &str,
        text: String,
        role: Option<String>,
    ) -> Result<oneshot::Receiver<Result<(), String>>, String> {
        let handle_arc = {
            let agents = self.agents.read().await;
            agents
                .get(agent_id)
                .cloned()
                .ok_or_else(|| format!("Agent '{}' not found", agent_id))?
        };

        let mut handle = handle_arc.lock().await;

        // Reject if a prompt is already queued or agent is working.
        if handle.pending_prompt.is_some() {
            return Err(format!(
                "Agent '{}' already has a pending prompt",
                agent_id
            ));
        }
        if handle.status != AgentStatus::Idle {
            return Err(format!(
                "Agent '{}' is not idle (current status: {})",
                agent_id, handle.status
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

    /// Wake an agent's prompt loop (e.g., after delivering a mailbox message).
    pub async fn notify_prompt_loop(&self, agent_id: &str) {
        let agents = self.agents.read().await;
        if let Some(handle_arc) = agents.get(agent_id) {
            let handle = handle_arc.lock().await;
            handle.prompt_notify.notify_one();
        }
    }

    /// Cancel the current prompt on an agent.
    pub async fn cancel_prompt(&self, agent_id: &str) -> Result<(), String> {
        let handle_arc = {
            let agents = self.agents.read().await;
            agents
                .get(agent_id)
                .cloned()
                .ok_or_else(|| format!("Agent '{}' not found", agent_id))?
        };

        let handle = handle_arc.lock().await;

        // No-op if the agent is not currently working — avoids spurious ACP errors.
        if handle.status != AgentStatus::Working {
            return Ok(());
        }

        let (reply_tx, reply_rx) = oneshot::channel();
        handle
            .command_tx
            .send(AgentCommand::Cancel { reply: reply_tx })
            .map_err(|_| "Agent thread has terminated".to_string())?;

        drop(handle);

        reply_rx
            .await
            .map_err(|_| "Agent thread terminated during cancel".to_string())?
    }

    /// Kill an agent, removing it from the map and terminating the subprocess.
    pub async fn kill_agent(&self, agent_id: &str) -> Result<(), String> {
        log::info!("Killing agent {}", agent_id);

        // Emit the dead status notification *before* removing from the map,
        // so the history recorder still has an entry for this agent_id.
        let _ = self.event_tx.send(Notification::StatusChange(StatusChangePayload {
            agent_id: agent_id.to_string(),
            status: AgentStatus::Dead.to_string(),
        }));

        let handle_arc = {
            let mut agents = self.agents.write().await;
            match agents.remove(agent_id) {
                Some(h) => h,
                None => return Ok(()),
            }
        };

        let mut handle = handle_arc.lock().await;

        // Abort the prompt loop task.
        if let Some(loop_handle) = handle.prompt_loop_handle.take() {
            loop_handle.abort();
        }

        // Signal the command loop to exit — this drops the ACP connection,
        // which closes stdin to the agent, giving it a chance to shut down
        // its MCP children gracefully per the MCP spec.
        let _ = handle.command_tx.send(AgentCommand::Shutdown);

        // Wait briefly for the agent to exit gracefully, then force kill.
        let exited = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            handle.child.wait(),
        )
        .await;
        if exited.is_err() {
            let _ = handle.child.kill().await;
        }

        // Drop the thread handle (do not join — just release ownership)
        drop(handle.thread_handle.take());

        // Notify connected peers of death before cleanup
        let peers = self.topology.read().await.peers(agent_id);
        let agent_name = &handle.cli;
        for peer_id in &peers {
            let mut mailboxes = self.mailboxes.write().await;
            if let Some(mailbox) = mailboxes.get_mut(peer_id) {
                mailbox.deliver(MailboxMessage {
                    sender: "system".to_string(),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    body: format!("Agent {} ({}) has disconnected.", agent_id, agent_name),
                });
            }
        }

        // Clean up mailbox, topology, and revoke bearer token
        self.mailboxes.write().await.remove(agent_id);
        self.topology.write().await.remove_agent(agent_id);
        self.token_registry.revoke_agent(agent_id);

        Ok(())
    }

    /// Kill all agents in a workspace.
    pub async fn kill_agents_in_workspace(
        &self,
        workspace_id: &WorkspaceId,
    ) -> Result<(), String> {
        let agent_ids: Vec<String> = {
            let agents = self.agents.read().await;
            let mut ids = Vec::new();
            for (id, handle_arc) in agents.iter() {
                let handle = handle_arc.lock().await;
                if &handle.workspace_id == workspace_id {
                    ids.push(id.clone());
                }
            }
            ids
        };

        for id in agent_ids {
            self.kill_agent(&id).await?;
        }

        Ok(())
    }

    /// List all running agents.
    pub async fn list_agents(&self) -> Vec<AgentSummary> {
        let agents = self.agents.read().await;
        let mut result = Vec::new();
        for (id, handle_arc) in agents.iter() {
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

    /// Get the current config options for an agent.
    pub async fn get_config(&self, agent_id: &str) -> Result<Vec<ConfigOption>, String> {
        let handle_arc = {
            let agents = self.agents.read().await;
            agents
                .get(agent_id)
                .cloned()
                .ok_or_else(|| format!("Agent '{}' not found", agent_id))?
        };
        let handle = handle_arc.lock().await;
        Ok(handle.config_options.clone())
    }

    /// Set a config option on an agent via ACP.
    pub async fn set_config(
        &self,
        agent_id: &str,
        config_id: String,
        value: String,
    ) -> Result<Vec<ConfigOption>, String> {
        let handle_arc = {
            let agents = self.agents.read().await;
            agents
                .get(agent_id)
                .cloned()
                .ok_or_else(|| format!("Agent '{}' not found", agent_id))?
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
                .map_err(|_| "Agent thread has terminated".to_string())?;
        }

        let new_config = reply_rx
            .await
            .map_err(|_| "Agent thread terminated during set_config".to_string())??;

        // Update stored config and emit notification with diff.
        {
            let mut handle = handle_arc.lock().await;
            let old_config = std::mem::replace(&mut handle.config_options, new_config.clone());
            let changes = crate::config::diff_config(&old_config, &new_config);
            if !changes.is_empty() {
                let _ = self.event_tx.send(Notification::ConfigUpdate(ConfigUpdatePayload {
                    agent_id: agent_id.to_string(),
                    config_options: new_config.clone(),
                    changes,
                }));
            }
        }

        Ok(new_config)
    }

    /// Get notification history for an agent.
    pub async fn get_history(&self, agent_id: &str) -> Result<Vec<Notification>, String> {
        let history = self.history.read().await;
        history
            .get(agent_id)
            .cloned()
            .ok_or_else(|| format!("Agent '{}' not found", agent_id))
    }

    // -----------------------------------------------------------------------
    // Swarm: topology management
    // -----------------------------------------------------------------------

    pub async fn connect_agents(&self, a: &str, b: &str) -> Result<(), String> {
        // Validate both agents are in the same workspace
        let (ws_a, ws_b) = {
            let agents = self.agents.read().await;
            let handle_a = agents.get(a).ok_or_else(|| format!("Agent '{}' not found", a))?;
            let handle_b = agents.get(b).ok_or_else(|| format!("Agent '{}' not found", b))?;
            let ws_a = handle_a.lock().await.workspace_id.clone();
            let ws_b = handle_b.lock().await.workspace_id.clone();
            (ws_a, ws_b)
        };
        if ws_a != ws_b {
            return Err("Cannot connect agents in different workspaces".to_string());
        }

        self.topology.write().await.connect(a, b);
        let _ = self.event_tx.send(Notification::TopologyChanged(
            emergent_protocol::TopologyChangedPayload {
                agent_id_a: a.to_string(),
                agent_id_b: b.to_string(),
            },
        ));
        Ok(())
    }

    pub async fn disconnect_agents(&self, a: &str, b: &str) {
        self.topology.write().await.disconnect(a, b);
        let _ = self.event_tx.send(Notification::TopologyChanged(
            emergent_protocol::TopologyChangedPayload {
                agent_id_a: a.to_string(),
                agent_id_b: b.to_string(),
            },
        ));
    }

    pub async fn get_connections(&self, agent_id: &str) -> Vec<String> {
        self.topology.read().await.peers(agent_id)
    }

    // -----------------------------------------------------------------------
    // Swarm: permissions
    // -----------------------------------------------------------------------

    pub async fn set_management_permissions(
        &self,
        agent_id: &str,
        enabled: bool,
    ) -> Result<(), String> {
        let agents = self.agents.read().await;
        let handle_arc = agents
            .get(agent_id)
            .ok_or_else(|| format!("Agent not found: {}", agent_id))?;
        handle_arc.lock().await.has_management_permissions = enabled;
        Ok(())
    }

    pub async fn has_management_permissions(&self, agent_id: &str) -> bool {
        let agents = self.agents.read().await;
        match agents.get(agent_id) {
            Some(handle_arc) => handle_arc.lock().await.has_management_permissions,
            None => false,
        }
    }

    // -----------------------------------------------------------------------
    // Swarm: mailbox
    // -----------------------------------------------------------------------

    pub async fn deliver_message(
        &self,
        from: &str,
        to: &str,
        body: String,
    ) -> Result<(), String> {
        // Check topology
        if !self.topology.read().await.is_connected(from, to) {
            return Err(format!("Agents {} and {} are not connected", from, to));
        }
        // Check same workspace
        {
            let agents = self.agents.read().await;
            let from_handle = agents.get(from).ok_or_else(|| format!("Agent '{}' not found", from))?;
            let to_handle = agents.get(to).ok_or_else(|| format!("Agent '{}' not found", to))?;
            let ws_from = from_handle.lock().await.workspace_id.clone();
            let ws_to = to_handle.lock().await.workspace_id.clone();
            if ws_from != ws_to {
                return Err("Cannot send messages between agents in different workspaces".to_string());
            }
        }
        // Check target exists
        if !self.agents.read().await.contains_key(to) {
            return Err(format!("Agent not found: {}", to));
        }
        // Look up agent names for the notification
        let (from_name, to_name) = {
            let agents = self.agents.read().await;
            let f = match agents.get(from) {
                Some(h) => h.lock().await.cli.clone(),
                None => from.to_string(),
            };
            let t = match agents.get(to) {
                Some(h) => h.lock().await.cli.clone(),
                None => to.to_string(),
            };
            (f, t)
        };

        let timestamp = chrono::Utc::now().to_rfc3339();

        // Deliver
        let mut mailboxes = self.mailboxes.write().await;
        let mailbox = mailboxes
            .entry(to.to_string())
            .or_insert_with(Mailbox::new);
        mailbox.deliver(MailboxMessage {
            sender: from.to_string(),
            timestamp: timestamp.clone(),
            body: body.clone(),
        });
        drop(mailboxes);

        // Emit swarm message notification for the communication log
        let _ = self.event_tx.send(Notification::SwarmMessage(SwarmMessagePayload {
            from_agent_id: from.to_string(),
            from_agent_name: from_name,
            to_agent_id: to.to_string(),
            to_agent_name: to_name,
            body,
            timestamp,
        }));

        Ok(())
    }

    pub async fn is_agent_idle(&self, agent_id: &str) -> bool {
        let agents = self.agents.read().await;
        match agents.get(agent_id) {
            Some(h) => h.lock().await.status == AgentStatus::Idle,
            None => false,
        }
    }

    pub async fn read_mailbox(&self, agent_id: &str) -> Vec<MailboxMessage> {
        let mut mailboxes = self.mailboxes.write().await;
        match mailboxes.get_mut(agent_id) {
            Some(mailbox) => mailbox.read_and_clear(),
            None => vec![],
        }
    }

    pub async fn mailbox_len(&self, agent_id: &str) -> usize {
        let mailboxes = self.mailboxes.read().await;
        mailboxes.get(agent_id).map_or(0, |m| m.len())
    }
}

/// Enrich PATH with common CLI install locations.
/// macOS bundled apps launch with a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin),
/// so tools installed via npm, bun, cargo, etc. won't be found without this.
fn enrich_path() {
    let home = match std::env::var("HOME") {
        Ok(h) => std::path::PathBuf::from(h),
        Err(_) => return,
    };

    let extra_dirs: Vec<std::path::PathBuf> = vec![
        home.join(".local/bin"),
        home.join(".cargo/bin"),
        home.join(".bun/bin"),
        home.join(".nvm/current/bin"),
        home.join(".local/share/fnm/aliases/default/bin"),
        std::path::PathBuf::from("/usr/local/bin"),
        std::path::PathBuf::from("/opt/homebrew/bin"),
    ];

    let current_path = std::env::var("PATH").unwrap_or_default();
    let mut dirs: Vec<std::path::PathBuf> = std::env::split_paths(&current_path).collect();

    for dir in extra_dirs {
        if dir.is_dir() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }

    if let Ok(new_path) = std::env::join_paths(&dirs) {
        unsafe { std::env::set_var("PATH", &new_path) };
    }
}
