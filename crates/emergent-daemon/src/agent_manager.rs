use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use acp::Agent as _;
use agent_client_protocol as acp;
use emergent_protocol::{
    AgentErrorPayload, AgentStatus, AgentSummary, ConfigOption, ConfigUpdatePayload,
    MessageChunkPayload, Notification, NudgeDeliveredPayload, PromptCompletePayload,
    StatusChangePayload, SwarmMessagePayload, ToolCallContentPayload, ToolCallUpdatePayload,
    UserMessagePayload,
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

struct AgentHandle {
    status: AgentStatus,
    cli: String,
    working_directory: PathBuf,
    command_tx: mpsc::UnboundedSender<AgentCommand>,
    /// Handle to the OS-level child process (for kill).
    child: tokio::process::Child,
    /// Handle to the dedicated ACP thread (kept for ownership; not joined).
    thread_handle: Option<std::thread::JoinHandle<()>>,
    config_options: Vec<ConfigOption>,
    has_management_permissions: bool,
}

// ---------------------------------------------------------------------------
// EmergentClient — implements acp::Client on the LocalSet thread
// ---------------------------------------------------------------------------

struct EmergentClient {
    agent_id: String,
    event_tx: broadcast::Sender<Notification>,
    config: std::sync::Arc<std::sync::Mutex<Vec<ConfigOption>>>,
}

impl EmergentClient {
    fn new(
        agent_id: String,
        event_tx: broadcast::Sender<Notification>,
        config: std::sync::Arc<std::sync::Mutex<Vec<ConfigOption>>>,
    ) -> Self {
        Self {
            agent_id,
            event_tx,
            config,
        }
    }

    fn emit(&self, notification: Notification) {
        log::trace!(
            "Agent {} ACP notification: {}",
            &self.agent_id,
            notification.event_name()
        );
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
        log::trace!(
            "Agent {} received ACP session update: {:?}",
            &self.agent_id,
            std::mem::discriminant(&args.update)
        );
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
                log::debug!(
                    "Agent {} tool call: {} (id: {}, status: {:?})",
                    &self.agent_id,
                    tc.title,
                    tc.tool_call_id,
                    tc.status
                );
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
            acp::SessionUpdate::Plan(plan) => {
                for (i, entry) in plan.entries.iter().enumerate() {
                    log::debug!(
                        "Agent {} plan[{}]: [{:?}] {:?} — {}",
                        &self.agent_id,
                        i,
                        entry.status,
                        entry.priority,
                        entry.content
                    );
                }
            }
            acp::SessionUpdate::ConfigOptionUpdate(update) => {
                let new_config = crate::config::convert_config_options(&update.config_options);
                let old_config = {
                    let mut guard = self.config.lock().unwrap();
                    let old = guard.clone();
                    *guard = new_config.clone();
                    old
                };
                let changes = crate::config::diff_config(&old_config, &new_config);
                self.emit(Notification::ConfigUpdate(ConfigUpdatePayload {
                    agent_id: self.agent_id.clone(),
                    config_options: new_config,
                    changes,
                }));
            }
            _ => {
                // AvailableCommandsUpdate, usage_update, etc. — ignored for v1
            }
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// AgentManager
// ---------------------------------------------------------------------------

pub struct AgentManager {
    agents: Arc<RwLock<HashMap<String, Arc<Mutex<AgentHandle>>>>>,
    event_tx: broadcast::Sender<Notification>,
    history: Arc<RwLock<HashMap<String, Vec<Notification>>>>,
    mailboxes: Arc<RwLock<HashMap<String, crate::mailbox::Mailbox>>>,
    topology: Arc<RwLock<crate::topology::Topology>>,
}

impl Default for AgentManager {
    fn default() -> Self {
        Self::new()
    }
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
            agents: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
            history,
            mailboxes: Arc::new(RwLock::new(HashMap::new())),
            topology: Arc::new(RwLock::new(crate::topology::Topology::new())),
        }
    }

    /// Subscribe to the notification broadcast channel.
    pub fn subscribe(&self) -> broadcast::Receiver<Notification> {
        self.event_tx.subscribe()
    }

    /// Spawn an agent subprocess asynchronously.
    ///
    /// Returns the agent ID immediately. The ACP handshake runs in a background
    /// task and emits `StatusChange(Idle)` or `Error` notifications on completion.
    pub async fn spawn_agent(
        &self,
        working_directory: PathBuf,
        agent_binary: String,
    ) -> Result<String, String> {
        let agent_id = Self::generate_short_id();

        log::info!(
            "Spawning agent {} (cli: {}, wd: {})",
            &agent_id,
            agent_binary,
            working_directory.display()
        );

        // Return ID immediately — the frontend sets "initializing" status locally.
        // Initialization (process spawn + ACP handshake) runs asynchronously.
        let agents = self.agents.clone();
        let event_tx = self.event_tx.clone();
        let history = self.history.clone();
        let mailboxes = self.mailboxes.clone();
        let id = agent_id.clone();

        let socket_path = crate::socket::socket_path();

        tokio::spawn(async move {
            match Self::initialize_agent(
                id.clone(),
                working_directory,
                agent_binary,
                agents,
                event_tx.clone(),
                history,
                mailboxes,
                socket_path,
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

    /// Perform the full agent initialization: spawn process, ACP handshake,
    /// store handle, and emit notifications.
    #[allow(clippy::too_many_arguments)]
    async fn initialize_agent(
        agent_id: String,
        working_directory: PathBuf,
        agent_binary: String,
        agents: Arc<RwLock<HashMap<String, Arc<Mutex<AgentHandle>>>>>,
        event_tx: broadcast::Sender<Notification>,
        history: Arc<RwLock<HashMap<String, Vec<Notification>>>>,
        mailboxes: Arc<RwLock<HashMap<String, crate::mailbox::Mailbox>>>,
        socket_path: PathBuf,
    ) -> Result<(), String> {
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
        let event_tx_clone = event_tx.clone();
        let wd = working_directory.clone();

        // Use a oneshot to receive the session_id + initial config (or error) from the LocalSet thread.
        let (init_tx, init_rx) =
            oneshot::channel::<Result<(acp::SessionId, Vec<ConfigOption>), String>>();

        // Spawn a dedicated thread running a LocalSet for the !Send ACP connection.
        let thread_handle = std::thread::Builder::new()
            .name(format!("acp-agent-{}", &agent_id))
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
                    let config_state =
                        std::sync::Arc::new(std::sync::Mutex::new(Vec::<ConfigOption>::new()));
                    let client = EmergentClient::new(
                        agent_id.clone(),
                        event_tx_clone.clone(),
                        config_state.clone(),
                    );

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
                    log::debug!("Agent {} starting ACP handshake", &agent_id);
                    let init_result = async {
                        conn.initialize(
                            acp::InitializeRequest::new(acp::ProtocolVersion::V1).client_info(
                                acp::Implementation::new("emergent", "0.1.0").title("Emergent"),
                            ),
                        )
                        .await
                        .map_err(|e| format!("ACP initialize failed: {}", e))?;

                        // Build MCP server config for swarm communication
                        let mcp_config =
                            crate::mcp::SwarmMcpServer::mcp_config_for_agent(
                                &agent_id, &socket_path,
                            )
                            .map_err(|e| format!("MCP config failed: {}", e))?;

                        let session_resp = conn
                            .new_session(
                                acp::NewSessionRequest::new(&wd)
                                    .mcp_servers(vec![mcp_config]),
                            )
                            .await
                            .map_err(|e| format!("ACP new_session failed: {}", e))?;

                        let initial_config = session_resp
                            .config_options
                            .as_deref()
                            .map(crate::config::convert_config_options)
                            .unwrap_or_default();

                        // Store initial config in the EmergentClient for diffing
                        *config_state.lock().unwrap() = initial_config.clone();

                        Ok::<_, String>((session_resp.session_id, initial_config))
                    }
                    .await;

                    let session_id = match init_result {
                        Ok((sid, config)) => {
                            log::debug!("Agent {} ACP session established: {:?}", &agent_id, sid);
                            let _ = init_tx.send(Ok((sid.clone(), config)));
                            sid
                        }
                        Err(e) => {
                            log::error!("Agent {} ACP handshake failed: {}", &agent_id, e);
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
        let (_session_id, initial_config) = init_rx
            .await
            .map_err(|_| "Agent thread terminated during initialization".to_string())??;

        // Store the handle
        let handle = AgentHandle {
            status: AgentStatus::Idle,
            cli: agent_binary,
            working_directory,
            command_tx,
            child,
            thread_handle: Some(thread_handle),
            config_options: initial_config.clone(),
            has_management_permissions: false,
        };

        let _ = event_tx.send(Notification::StatusChange(StatusChangePayload {
            agent_id: agent_id.clone(),
            status: AgentStatus::Idle.to_string(),
        }));

        // Emit initial config if the agent advertised any
        if !initial_config.is_empty() {
            let _ = event_tx.send(Notification::ConfigUpdate(ConfigUpdatePayload {
                agent_id: agent_id.clone(),
                config_options: initial_config,
                changes: vec![],
            }));
        }

        agents
            .write()
            .await
            .insert(agent_id.clone(), Arc::new(Mutex::new(handle)));

        // Initialize mailbox for this agent
        mailboxes
            .write()
            .await
            .insert(agent_id.clone(), crate::mailbox::Mailbox::new());

        // Initialize history for this agent
        history
            .write()
            .await
            .entry(agent_id)
            .or_default();

        Ok(())
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
                    log::debug!(
                        "Agent {} prompt: {}",
                        &agent_id,
                        if text.len() > 100 { &text[..100] } else { &text }
                    );
                    let _ = event_tx.send(Notification::StatusChange(StatusChangePayload {
                        agent_id: agent_id.clone(),
                        status: AgentStatus::Working.to_string(),
                    }));

                    let prompt_req = acp::PromptRequest::new(session_id.clone(), vec![text.into()]);

                    // Use select! so cancel commands are handled immediately
                    // while the prompt is in-flight.
                    let prompt_fut = conn.prompt(prompt_req);
                    tokio::pin!(prompt_fut);

                    let prompt_result;
                    loop {
                        tokio::select! {
                            result = &mut prompt_fut => {
                                prompt_result = result;
                                break;
                            }
                            cmd = command_rx.recv() => {
                                match cmd {
                                    Some(AgentCommand::Cancel { reply: cancel_reply }) => {
                                        log::debug!("Agent {} cancel requested (during prompt)", &agent_id);
                                        let cancel = acp::CancelNotification::new(session_id.clone());
                                        match conn.cancel(cancel).await {
                                            Ok(()) => { let _ = cancel_reply.send(Ok(())); }
                                            Err(e) => { let _ = cancel_reply.send(Err(format!("Cancel failed: {}", e))); }
                                        }
                                        // Continue waiting for prompt to finish after cancel
                                    }
                                    Some(AgentCommand::Shutdown) => {
                                        log::debug!("Agent {} shutdown during prompt", &agent_id);
                                        let _ = reply.send(Err("Agent shut down".to_string()));
                                        return;
                                    }
                                    Some(AgentCommand::Prompt { reply: dup_reply, .. }) => {
                                        let _ = dup_reply.send(Err("Agent is already working".to_string()));
                                    }
                                    Some(AgentCommand::SetConfig { config_id, value, reply: cfg_reply }) => {
                                        log::debug!("Agent {} set_config during prompt: {} = {}", &agent_id, config_id, value);
                                        let req = acp::SetSessionConfigOptionRequest::new(
                                            session_id.clone(),
                                            config_id,
                                            value,
                                        );
                                        match conn.set_session_config_option(req).await {
                                            Ok(resp) => {
                                                let new_config = crate::config::convert_config_options(&resp.config_options);
                                                let _ = cfg_reply.send(Ok(new_config));
                                            }
                                            Err(e) => {
                                                let _ = cfg_reply.send(Err(format!("set_config failed: {}", e)));
                                            }
                                        }
                                    }
                                    None => {
                                        let _ = reply.send(Err("Command channel closed".to_string()));
                                        return;
                                    }
                                }
                            }
                        }
                    }

                    match prompt_result {
                        Ok(resp) => {
                            let stop_reason = format!("{:?}", resp.stop_reason);
                            log::debug!(
                                "Agent {} prompt complete (stop_reason: {})",
                                &agent_id,
                                stop_reason
                            );
                            let _ =
                                event_tx.send(Notification::PromptComplete(PromptCompletePayload {
                                    agent_id: agent_id.clone(),
                                    stop_reason,
                                }));
                            let _ = reply.send(Ok(()));
                        }
                        Err(e) => {
                            log::error!("Agent {} prompt failed: {}", &agent_id, e);
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
                    log::debug!("Agent {} cancel requested", &agent_id);
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
                AgentCommand::SetConfig {
                    config_id,
                    value,
                    reply,
                } => {
                    log::debug!(
                        "Agent {} set_config: {} = {}",
                        &agent_id,
                        config_id,
                        value
                    );
                    let req = acp::SetSessionConfigOptionRequest::new(
                        session_id.clone(),
                        config_id,
                        value,
                    );
                    match conn.set_session_config_option(req).await {
                        Ok(resp) => {
                            let new_config =
                                crate::config::convert_config_options(&resp.config_options);
                            let _ = reply.send(Ok(new_config));
                        }
                        Err(e) => {
                            let _ = reply.send(Err(format!("set_config failed: {}", e)));
                        }
                    }
                }
                AgentCommand::Shutdown => {
                    log::debug!("Agent {} shutting down", &agent_id);
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

        // Record the user message so it appears in history
        // (emitted before NudgeDelivered so replay attaches nudge to user message)
        // Skip for empty text (nudge-only auto-prompts)
        if !text.is_empty() {
            let _ = self.event_tx.send(Notification::UserMessage(UserMessagePayload {
                agent_id: agent_id.to_string(),
                content: text.clone(),
            }));
        }

        // Check mailbox and coalesce nudge into the prompt text
        let mailbox_count = self.mailbox_len(agent_id).await;
        let prompt_text = if mailbox_count > 0 {
            let nudge = if mailbox_count == 1 {
                "You have 1 unread message in your mailbox.".to_string()
            } else {
                format!(
                    "You have {} unread messages in your mailbox.",
                    mailbox_count
                )
            };

            // Emit NudgeDelivered after UserMessage so replay can attach it
            let _ = self.event_tx.send(Notification::NudgeDelivered(
                NudgeDeliveredPayload {
                    agent_id: agent_id.to_string(),
                    count: mailbox_count,
                },
            ));

            if text.is_empty() {
                nudge
            } else {
                format!("{}\n\n{}", text, nudge)
            }
        } else {
            text
        };

        let (reply_tx, reply_rx) = oneshot::channel();
        handle
            .command_tx
            .send(AgentCommand::Prompt {
                text: prompt_text,
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
        drop(handle);

        result
    }

    /// Check mailbox after prompt completion and auto-send a nudge if needed.
    /// Must be called with an Arc reference since it spawns a background task.
    pub async fn maybe_auto_nudge(self: &Arc<Self>, agent_id: &str) {
        if self.mailbox_len(agent_id).await > 0 {
            let mgr = self.clone();
            let agent_id_owned = agent_id.to_string();
            tokio::spawn(async move {
                if let Err(e) = mgr.send_prompt(&agent_id_owned, String::new()).await {
                    log::warn!("Auto-nudge for agent {} failed: {}", agent_id_owned, e);
                }
            });
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

        // Notify connected peers of death before cleanup
        let peers = self.topology.read().await.peers(agent_id);
        let agent_name = &handle.cli;
        for peer_id in &peers {
            let mut mailboxes = self.mailboxes.write().await;
            if let Some(mailbox) = mailboxes.get_mut(peer_id) {
                mailbox.deliver(crate::mailbox::MailboxMessage {
                    sender: "system".to_string(),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    body: format!("Agent {} ({}) has disconnected.", agent_id, agent_name),
                });
            }
        }

        // Clean up mailbox and topology
        self.mailboxes.write().await.remove(agent_id);
        self.topology.write().await.remove_agent(agent_id);

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

    pub async fn connect_agents(&self, a: &str, b: &str) {
        self.topology.write().await.connect(a, b);
    }

    pub async fn disconnect_agents(&self, a: &str, b: &str) {
        self.topology.write().await.disconnect(a, b);
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
            .or_insert_with(crate::mailbox::Mailbox::new);
        mailbox.deliver(crate::mailbox::MailboxMessage {
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

    pub async fn read_mailbox(&self, agent_id: &str) -> Vec<crate::mailbox::MailboxMessage> {
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
