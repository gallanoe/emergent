use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use acp::Agent as _;
use agent_client_protocol as acp;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

// ---------------------------------------------------------------------------
// Event payload structs (emitted to frontend via Tauri events)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MessageChunkPayload {
    pub agent_id: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolCallUpdatePayload {
    pub agent_id: String,
    pub tool_call_id: String,
    pub title: Option<String>,
    pub status: Option<String>,
    pub content: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PromptCompletePayload {
    pub agent_id: String,
    pub stop_reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentErrorPayload {
    pub agent_id: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StatusChangePayload {
    pub agent_id: String,
    pub status: String,
}

// ---------------------------------------------------------------------------
// AgentStatus
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum AgentStatus {
    Initializing,
    Idle,
    Working,
    Error,
}

impl std::fmt::Display for AgentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentStatus::Initializing => write!(f, "initializing"),
            AgentStatus::Idle => write!(f, "idle"),
            AgentStatus::Working => write!(f, "working"),
            AgentStatus::Error => write!(f, "error"),
        }
    }
}

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
    app: tauri::AppHandle,
}

impl EmergentClient {
    fn new(agent_id: String, app: tauri::AppHandle) -> Self {
        Self { agent_id, app }
    }

    fn tool_call_status_str(status: &acp::ToolCallStatus) -> String {
        // Use serde serialization to get the snake_case string that matches the ACP spec
        serde_json::to_value(status)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_else(|| format!("{:?}", status))
    }

    fn extract_tool_call_content(content: &[acp::ToolCallContent]) -> Option<String> {
        if content.is_empty() {
            return None;
        }
        let texts: Vec<String> = content
            .iter()
            .map(|c| match c {
                acp::ToolCallContent::Content(inner) => Self::extract_text(&inner.content),
                acp::ToolCallContent::Diff(diff) => format!("[diff: {}]", diff.path.display()),
                acp::ToolCallContent::Terminal(term) => format!("[terminal: {}]", term.terminal_id),
                _ => "[unknown]".into(),
            })
            .collect();
        Some(texts.join(""))
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
        use tauri::Emitter;

        match args.update {
            acp::SessionUpdate::AgentMessageChunk(chunk) => {
                let text = Self::extract_text(&chunk.content);
                let _ = self.app.emit(
                    "agent:message-chunk",
                    MessageChunkPayload {
                        agent_id: self.agent_id.clone(),
                        content: text,
                    },
                );
            }
            acp::SessionUpdate::ToolCall(tc) => {
                let _ = self.app.emit(
                    "agent:tool-call-update",
                    ToolCallUpdatePayload {
                        agent_id: self.agent_id.clone(),
                        tool_call_id: tc.tool_call_id.to_string(),
                        title: Some(tc.title.clone()),
                        status: Some(Self::tool_call_status_str(&tc.status)),
                        content: Self::extract_tool_call_content(&tc.content),
                    },
                );
            }
            acp::SessionUpdate::ToolCallUpdate(tcu) => {
                let _ = self.app.emit(
                    "agent:tool-call-update",
                    ToolCallUpdatePayload {
                        agent_id: self.agent_id.clone(),
                        tool_call_id: tcu.tool_call_id.to_string(),
                        title: tcu.fields.title.clone(),
                        status: tcu.fields.status.map(|s| Self::tool_call_status_str(&s)),
                        content: tcu
                            .fields
                            .content
                            .as_ref()
                            .and_then(|c| Self::extract_tool_call_content(c)),
                    },
                );
            }
            acp::SessionUpdate::AgentThoughtChunk(chunk) => {
                let text = Self::extract_text(&chunk.content);
                let _ = self.app.emit(
                    "agent:message-chunk",
                    MessageChunkPayload {
                        agent_id: self.agent_id.clone(),
                        content: text,
                    },
                );
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
}

impl AgentManager {
    pub fn new() -> Self {
        Self {
            agents: RwLock::new(HashMap::new()),
        }
    }

    /// Spawn an agent subprocess, perform ACP handshake, create a session,
    /// and store the connection handle.
    pub async fn spawn_agent(
        &self,
        app: tauri::AppHandle,
        working_directory: PathBuf,
        agent_binary: String,
    ) -> Result<String, String> {
        use tauri::Emitter;

        let agent_id = uuid::Uuid::new_v4().to_string();

        // Emit initializing status
        let _ = app.emit(
            "agent:status-change",
            StatusChangePayload {
                agent_id: agent_id.clone(),
                status: AgentStatus::Initializing.to_string(),
            },
        );

        // Spawn the agent subprocess
        let mut child = tokio::process::Command::new(&agent_binary)
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
        let app_clone = app.clone();
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
                    let client = EmergentClient::new(agent_id.clone(), app_clone.clone());

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
                    Self::agent_command_loop(conn, session_id, command_rx, agent_id, app_clone)
                        .await;
                });
            })
            .map_err(|e| format!("Failed to spawn agent thread: {}", e))?;

        // Wait for initialization to complete
        let _session_id = init_rx
            .await
            .map_err(|_| "Agent thread terminated during initialization".to_string())?
            .inspect_err(|e| {
                let _ = app.emit(
                    "agent:error",
                    AgentErrorPayload {
                        agent_id: agent_id.clone(),
                        message: e.clone(),
                    },
                );
            })?;

        // Store the handle
        let handle = AgentHandle {
            status: AgentStatus::Idle,
            command_tx,
            child,
            thread_handle: Some(thread_handle),
        };

        let _ = app.emit(
            "agent:status-change",
            StatusChangePayload {
                agent_id: agent_id.clone(),
                status: AgentStatus::Idle.to_string(),
            },
        );

        self.agents
            .write()
            .await
            .insert(agent_id.clone(), Arc::new(Mutex::new(handle)));

        Ok(agent_id)
    }

    /// The command loop runs on the LocalSet thread, processing prompt/cancel/shutdown.
    async fn agent_command_loop(
        conn: acp::ClientSideConnection,
        session_id: acp::SessionId,
        mut command_rx: mpsc::UnboundedReceiver<AgentCommand>,
        agent_id: String,
        app: tauri::AppHandle,
    ) {
        use tauri::Emitter;

        while let Some(cmd) = command_rx.recv().await {
            match cmd {
                AgentCommand::Prompt { text, reply } => {
                    let _ = app.emit(
                        "agent:status-change",
                        StatusChangePayload {
                            agent_id: agent_id.clone(),
                            status: AgentStatus::Working.to_string(),
                        },
                    );

                    let prompt_req = acp::PromptRequest::new(session_id.clone(), vec![text.into()]);

                    match conn.prompt(prompt_req).await {
                        Ok(resp) => {
                            let stop_reason = format!("{:?}", resp.stop_reason);
                            let _ = app.emit(
                                "agent:prompt-complete",
                                PromptCompletePayload {
                                    agent_id: agent_id.clone(),
                                    stop_reason,
                                },
                            );
                            let _ = reply.send(Ok(()));
                        }
                        Err(e) => {
                            let msg = format!("Prompt failed: {}", e);
                            let _ = app.emit(
                                "agent:error",
                                AgentErrorPayload {
                                    agent_id: agent_id.clone(),
                                    message: msg.clone(),
                                },
                            );
                            let _ = reply.send(Err(msg));
                        }
                    }

                    let _ = app.emit(
                        "agent:status-change",
                        StatusChangePayload {
                            agent_id: agent_id.clone(),
                            status: AgentStatus::Idle.to_string(),
                        },
                    );
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
    pub async fn send_prompt(
        &self,
        app: tauri::AppHandle,
        agent_id: &str,
        text: String,
    ) -> Result<(), String> {
        // Extract the Arc'd handle, then immediately drop the map lock.
        let handle_arc = {
            let agents = self.agents.read().await;
            agents
                .get(agent_id)
                .cloned()
                .ok_or_else(|| format!("Agent '{}' not found", agent_id))?
        };

        // Lock individual agent — does not block other agents or kill_agent on the map.
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
                use tauri::Emitter;
                let _ = app.emit(
                    "agent:status-change",
                    StatusChangePayload {
                        agent_id: agent_id.to_string(),
                        status: AgentStatus::Error.to_string(),
                    },
                );
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
}
