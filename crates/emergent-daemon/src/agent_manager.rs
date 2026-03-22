use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use acp::Agent as _;
use agent_client_protocol as acp;
use emergent_protocol::{
    AgentErrorPayload, AgentStatus, AgentSummary, MessageChunkPayload, Notification,
    PromptCompletePayload, StatusChangePayload, ToolCallContentPayload, ToolCallUpdatePayload,
};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex, RwLock};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

// ---------------------------------------------------------------------------
// Commands sent to the dedicated ACP thread
// ---------------------------------------------------------------------------

enum AgentCommand {
    Prompt {
        text: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Cancel {
        reply: oneshot::Sender<Result<(), String>>,
    },
    Shutdown,
}

// ---------------------------------------------------------------------------
// AgentHandle — the Send-safe handle stored in the manager map
// ---------------------------------------------------------------------------

struct AgentHandle {
    status: AgentStatus,
    cli: String,
    working_directory: PathBuf,
    command_tx: mpsc::UnboundedSender<AgentCommand>,
    /// Handle to the OS-level child process (for kill).
    child: tokio::process::Child,
    /// Handle to the dedicated ACP thread (kept for ownership; not joined).
    thread_handle: Option<std::thread::JoinHandle<()>>,
}

// ---------------------------------------------------------------------------
// EmergentClient — implements acp::Client on the LocalSet thread
// ---------------------------------------------------------------------------

struct EmergentClient {
    agent_id: String,
    event_tx: broadcast::Sender<Notification>,
}

impl EmergentClient {
    fn new(agent_id: String, event_tx: broadcast::Sender<Notification>) -> Self {
        Self { agent_id, event_tx }
    }

    fn emit(&self, notification: Notification) {
        let _ = self.event_tx.send(notification);
    }

    fn tool_call_status_str(status: &acp::ToolCallStatus) -> String {
        serde_json::to_value(status)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_else(|| format!("{:?}", status))
    }

    fn extract_tool_call_content(
        content: &[acp::ToolCallContent],
    ) -> Option<Vec<ToolCallContentPayload>> {
        if content.is_empty() {
            return None;
        }
        let items: Vec<ToolCallContentPayload> = content
            .iter()
            .map(|c| match c {
                acp::ToolCallContent::Content(inner) => ToolCallContentPayload::Text {
                    text: Self::extract_text(&inner.content),
                },
                acp::ToolCallContent::Diff(diff) => ToolCallContentPayload::Diff {
                    path: diff.path.display().to_string(),
                    old_text: diff.old_text.clone(),
                    new_text: diff.new_text.clone(),
                },
                acp::ToolCallContent::Terminal(term) => ToolCallContentPayload::Terminal {
                    terminal_id: term.terminal_id.to_string(),
                    output: None,
                    exit_code: None,
                },
                _ => {
                    log::warn!("Unknown ToolCallContent variant encountered");
                    ToolCallContentPayload::Text {
                        text: "[unknown]".into(),
                    }
                }
            })
            .collect();
        Some(items)
    }

    fn extract_locations(locations: &[acp::ToolCallLocation]) -> Option<Vec<String>> {
        if locations.is_empty() {
            return None;
        }
        Some(
            locations
                .iter()
                .map(|l| l.path.display().to_string())
                .collect(),
        )
    }

    fn tool_kind_str(kind: &acp::ToolKind) -> String {
        serde_json::to_value(kind)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_else(|| "other".into())
    }

    fn extract_text(content: &acp::ContentBlock) -> String {
        match content {
            acp::ContentBlock::Text(tc) => tc.text.clone(),
            acp::ContentBlock::Image(_) => "[image]".into(),
            acp::ContentBlock::Audio(_) => "[audio]".into(),
            acp::ContentBlock::ResourceLink(rl) => rl.uri.clone(),
            acp::ContentBlock::Resource(_) => "[resource]".into(),
            _ => "[unknown content]".into(),
        }
    }
}

#[async_trait::async_trait(?Send)]
impl acp::Client for EmergentClient {
    async fn request_permission(
        &self,
        args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        // Auto-approve for v1: select the first option if available
        let outcome = if let Some(first) = args.options.first() {
            acp::RequestPermissionOutcome::Selected(acp::SelectedPermissionOutcome::new(
                first.option_id.clone(),
            ))
        } else {
            acp::RequestPermissionOutcome::Cancelled
        };
        Ok(acp::RequestPermissionResponse::new(outcome))
    }

    async fn session_notification(&self, args: acp::SessionNotification) -> acp::Result<()> {
        match args.update {
            acp::SessionUpdate::AgentMessageChunk(chunk) => {
                let text = Self::extract_text(&chunk.content);
                self.emit(Notification::MessageChunk(MessageChunkPayload {
                    agent_id: self.agent_id.clone(),
                    content: text,
                    kind: "message".into(),
                }));
            }
            acp::SessionUpdate::ToolCall(tc) => {
                self.emit(Notification::ToolCallUpdate(ToolCallUpdatePayload {
                    agent_id: self.agent_id.clone(),
                    tool_call_id: tc.tool_call_id.to_string(),
                    title: Some(tc.title.clone()),
                    kind: Some(Self::tool_kind_str(&tc.kind)),
                    status: Some(Self::tool_call_status_str(&tc.status)),
                    locations: Self::extract_locations(&tc.locations),
                    content: Self::extract_tool_call_content(&tc.content),
                }));
            }
            acp::SessionUpdate::ToolCallUpdate(tcu) => {
                self.emit(Notification::ToolCallUpdate(ToolCallUpdatePayload {
                    agent_id: self.agent_id.clone(),
                    tool_call_id: tcu.tool_call_id.to_string(),
                    title: tcu.fields.title.clone(),
                    kind: tcu.fields.kind.map(|k| Self::tool_kind_str(&k)),
                    status: tcu.fields.status.map(|s| Self::tool_call_status_str(&s)),
                    locations: tcu
                        .fields
                        .locations
                        .as_ref()
                        .and_then(|l| Self::extract_locations(l)),
                    content: tcu
                        .fields
                        .content
                        .as_ref()
                        .and_then(|c| Self::extract_tool_call_content(c)),
                }));
            }
            acp::SessionUpdate::AgentThoughtChunk(chunk) => {
                let text = Self::extract_text(&chunk.content);
                self.emit(Notification::MessageChunk(MessageChunkPayload {
                    agent_id: self.agent_id.clone(),
                    content: text,
                    kind: "thinking".into(),
                }));
            }
            _ => {
                // Plan, AvailableCommandsUpdate, usage_update, etc. — ignored for v1
            }
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// AgentManager
// ---------------------------------------------------------------------------

pub struct AgentManager {
    agents: RwLock<HashMap<String, Arc<Mutex<AgentHandle>>>>,
    event_tx: broadcast::Sender<Notification>,
    history: Arc<RwLock<HashMap<String, Vec<Notification>>>>,
}

impl Default for AgentManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentManager {
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(1024);
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
            agents: RwLock::new(HashMap::new()),
            event_tx,
            history,
        }
    }

    /// Subscribe to the notification broadcast channel.
    pub fn subscribe(&self) -> broadcast::Receiver<Notification> {
        self.event_tx.subscribe()
    }

    /// Spawn an agent subprocess, perform ACP handshake, create a session,
    /// and store the connection handle.
    pub async fn spawn_agent(
        &self,
        working_directory: PathBuf,
        agent_binary: String,
    ) -> Result<String, String> {
        let agent_id = uuid::Uuid::new_v4().to_string();

        // Emit initializing status
        let _ = self.event_tx.send(Notification::StatusChange(StatusChangePayload {
            agent_id: agent_id.clone(),
            status: AgentStatus::Initializing.to_string(),
        }));

        // Parse command string into binary + args (e.g. "gemini --experimental-acp")
        let parts: Vec<&str> = agent_binary.split_whitespace().collect();
        let binary = parts
            .first()
            .ok_or_else(|| "Empty agent command".to_string())?;
        let args = &parts[1..];

        // Spawn the agent subprocess
        let mut child = tokio::process::Command::new(binary)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .current_dir(&working_directory)
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to spawn agent '{}': {}", agent_binary, e))?;

        let child_stdin = child.stdin.take().ok_or("Failed to capture agent stdin")?;
        let child_stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture agent stdout")?;

        let (command_tx, command_rx) = mpsc::unbounded_channel::<AgentCommand>();

        let agent_id_for_thread = agent_id.clone();
        let event_tx_clone = self.event_tx.clone();
        let wd = working_directory.clone();

        // Use a oneshot to receive the session_id (or error) from the LocalSet thread.
        let (init_tx, init_rx) = oneshot::channel::<Result<acp::SessionId, String>>();

        // Spawn a dedicated thread running a LocalSet for the !Send ACP connection.
        let thread_handle = std::thread::Builder::new()
            .name(format!("acp-agent-{}", &agent_id[..8]))
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("Failed to build tokio runtime for agent thread");

                let agent_id = agent_id_for_thread;
                let local = tokio::task::LocalSet::new();
                local.block_on(&rt, async move {
                    let outgoing = child_stdin.compat_write();
                    let incoming = child_stdout.compat();

                    let aid = agent_id.clone();
                    let client =
                        EmergentClient::new(agent_id.clone(), event_tx_clone.clone());

                    let (conn, handle_io) =
                        acp::ClientSideConnection::new(client, outgoing, incoming, |fut| {
                            tokio::task::spawn_local(fut);
                        });

                    // Spawn I/O handler
                    tokio::task::spawn_local(async move {
                        if let Err(e) = handle_io.await {
                            log::error!("ACP I/O error for agent {}: {}", aid, e);
                        }
                    });

                    // Initialize + create session
                    let init_result = async {
                        conn.initialize(
                            acp::InitializeRequest::new(acp::ProtocolVersion::V1).client_info(
                                acp::Implementation::new("emergent", "0.1.0").title("Emergent"),
                            ),
                        )
                        .await
                        .map_err(|e| format!("ACP initialize failed: {}", e))?;

                        let session_resp = conn
                            .new_session(acp::NewSessionRequest::new(&wd))
                            .await
                            .map_err(|e| format!("ACP new_session failed: {}", e))?;

                        Ok::<_, String>(session_resp.session_id)
                    }
                    .await;

                    let session_id = match init_result {
                        Ok(sid) => {
                            let _ = init_tx.send(Ok(sid.clone()));
                            sid
                        }
                        Err(e) => {
                            let _ = init_tx.send(Err(e));
                            return;
                        }
                    };

                    // Command loop: receive commands from the main thread
                    Self::agent_command_loop(
                        conn,
                        session_id,
                        command_rx,
                        agent_id,
                        event_tx_clone,
                    )
                    .await;
                });
            })
            .map_err(|e| format!("Failed to spawn agent thread: {}", e))?;

        // Wait for initialization to complete
        let _session_id = init_rx
            .await
            .map_err(|_| "Agent thread terminated during initialization".to_string())?
            .inspect_err(|e| {
                let _ = self.event_tx.send(Notification::Error(AgentErrorPayload {
                    agent_id: agent_id.clone(),
                    message: e.clone(),
                }));
            })?;

        // Store the handle
        let handle = AgentHandle {
            status: AgentStatus::Idle,
            cli: agent_binary,
            working_directory,
            command_tx,
            child,
            thread_handle: Some(thread_handle),
        };

        let _ = self.event_tx.send(Notification::StatusChange(StatusChangePayload {
            agent_id: agent_id.clone(),
            status: AgentStatus::Idle.to_string(),
        }));

        self.agents
            .write()
            .await
            .insert(agent_id.clone(), Arc::new(Mutex::new(handle)));

        // Initialize history for this agent
        self.history
            .write()
            .await
            .entry(agent_id.clone())
            .or_default();

        Ok(agent_id)
    }

    /// The command loop runs on the LocalSet thread, processing prompt/cancel/shutdown.
    async fn agent_command_loop(
        conn: acp::ClientSideConnection,
        session_id: acp::SessionId,
        mut command_rx: mpsc::UnboundedReceiver<AgentCommand>,
        agent_id: String,
        event_tx: broadcast::Sender<Notification>,
    ) {
        while let Some(cmd) = command_rx.recv().await {
            match cmd {
                AgentCommand::Prompt { text, reply } => {
                    let _ = event_tx.send(Notification::StatusChange(StatusChangePayload {
                        agent_id: agent_id.clone(),
                        status: AgentStatus::Working.to_string(),
                    }));

                    let prompt_req = acp::PromptRequest::new(session_id.clone(), vec![text.into()]);

                    match conn.prompt(prompt_req).await {
                        Ok(resp) => {
                            let stop_reason = format!("{:?}", resp.stop_reason);
                            let _ =
                                event_tx.send(Notification::PromptComplete(PromptCompletePayload {
                                    agent_id: agent_id.clone(),
                                    stop_reason,
                                }));
                            let _ = reply.send(Ok(()));
                        }
                        Err(e) => {
                            let msg = format!("Prompt failed: {}", e);
                            let _ = event_tx.send(Notification::Error(AgentErrorPayload {
                                agent_id: agent_id.clone(),
                                message: msg.clone(),
                            }));
                            let _ = reply.send(Err(msg));
                        }
                    }

                    let _ = event_tx.send(Notification::StatusChange(StatusChangePayload {
                        agent_id: agent_id.clone(),
                        status: AgentStatus::Idle.to_string(),
                    }));
                }
                AgentCommand::Cancel { reply } => {
                    let cancel = acp::CancelNotification::new(session_id.clone());
                    match conn.cancel(cancel).await {
                        Ok(()) => {
                            let _ = reply.send(Ok(()));
                        }
                        Err(e) => {
                            let _ = reply.send(Err(format!("Cancel failed: {}", e)));
                        }
                    }
                }
                AgentCommand::Shutdown => {
                    break;
                }
            }
        }
    }

    /// Send a prompt to a running agent.
    pub async fn send_prompt(&self, agent_id: &str, text: String) -> Result<(), String> {
        let handle_arc = {
            let agents = self.agents.read().await;
            agents
                .get(agent_id)
                .cloned()
                .ok_or_else(|| format!("Agent '{}' not found", agent_id))?
        };

        let mut handle = handle_arc.lock().await;

        if handle.status != AgentStatus::Idle {
            return Err(format!(
                "Agent '{}' is not idle (current status: {})",
                agent_id, handle.status
            ));
        }

        handle.status = AgentStatus::Working;

        let (reply_tx, reply_rx) = oneshot::channel();
        handle
            .command_tx
            .send(AgentCommand::Prompt {
                text,
                reply: reply_tx,
            })
            .map_err(|_| "Agent thread has terminated".to_string())?;

        // Drop the handle lock before waiting for the prompt to complete.
        drop(handle);

        let result = reply_rx
            .await
            .map_err(|_| "Agent thread terminated during prompt".to_string())?;

        // Update status back to Idle (or Error).
        let mut handle = handle_arc.lock().await;
        match &result {
            Ok(()) => {
                handle.status = AgentStatus::Idle;
            }
            Err(_) => {
                handle.status = AgentStatus::Error;
                let _ = self.event_tx.send(Notification::StatusChange(StatusChangePayload {
                    agent_id: agent_id.to_string(),
                    status: AgentStatus::Error.to_string(),
                }));
            }
        }

        result
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
        let handle_arc = {
            let mut agents = self.agents.write().await;
            match agents.remove(agent_id) {
                Some(h) => h,
                None => return Ok(()),
            }
        };

        let mut handle = handle_arc.lock().await;

        // Signal the command loop to exit
        let _ = handle.command_tx.send(AgentCommand::Shutdown);

        // Kill the child process
        let _ = handle.child.kill().await;

        // Drop the thread handle (do not join — just release ownership)
        drop(handle.thread_handle.take());

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
                working_directory: handle.working_directory.display().to_string(),
            });
        }
        result
    }

    /// Get notification history for an agent.
    pub async fn get_history(&self, agent_id: &str) -> Result<Vec<Notification>, String> {
        let history = self.history.read().await;
        history
            .get(agent_id)
            .cloned()
            .ok_or_else(|| format!("Agent '{}' not found", agent_id))
    }
}
