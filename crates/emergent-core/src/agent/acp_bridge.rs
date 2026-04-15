use acp::Agent as _;
use agent_client_protocol as acp;
use emergent_protocol::{
    ConfigOption, ConfigUpdatePayload, MessageChunkPayload, Notification, PromptCompletePayload,
    ThreadErrorPayload, ToolCallContentPayload, ToolCallEventPayload, UserMessagePayload,
};
use tokio::sync::{broadcast, mpsc};

use super::AgentCommand;

// ---------------------------------------------------------------------------
// EmergentClient — implements acp::Client on the LocalSet thread
// ---------------------------------------------------------------------------

pub(crate) struct EmergentClient {
    pub(crate) agent_id: String,
    pub(crate) event_tx: broadcast::Sender<Notification>,
    pub(crate) config: std::sync::Arc<std::sync::Mutex<Vec<ConfigOption>>>,
}

impl EmergentClient {
    pub(crate) fn new(
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
                    thread_id: self.agent_id.clone(),
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
                self.emit(Notification::ToolCallUpdate(ToolCallEventPayload {
                    thread_id: self.agent_id.clone(),
                    tool_call_id: tc.tool_call_id.to_string(),
                    title: Some(tc.title.clone()),
                    kind: Some(Self::tool_kind_str(&tc.kind)),
                    status: Some(Self::tool_call_status_str(&tc.status)),
                    locations: Self::extract_locations(&tc.locations),
                    content: Self::extract_tool_call_content(&tc.content),
                    raw_input: tc.raw_input.clone(),
                    raw_output: tc.raw_output.clone(),
                }));
            }
            acp::SessionUpdate::ToolCallUpdate(tcu) => {
                self.emit(Notification::ToolCallUpdate(ToolCallEventPayload {
                    thread_id: self.agent_id.clone(),
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
                    raw_input: tcu.fields.raw_input.clone(),
                    raw_output: tcu.fields.raw_output.clone(),
                }));
            }
            acp::SessionUpdate::UserMessageChunk(chunk) => {
                let text = Self::extract_text(&chunk.content);
                self.emit(Notification::UserMessage(UserMessagePayload {
                    thread_id: self.agent_id.clone(),
                    content: text,
                }));
            }
            acp::SessionUpdate::AgentThoughtChunk(chunk) => {
                let text = Self::extract_text(&chunk.content);
                self.emit(Notification::MessageChunk(MessageChunkPayload {
                    thread_id: self.agent_id.clone(),
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
                    thread_id: self.agent_id.clone(),
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
// ACP command loop — runs on the dedicated LocalSet thread
// ---------------------------------------------------------------------------

/// Process commands from the main thread on the ACP LocalSet thread.
/// Handles prompt/cancel/config/shutdown while supporting concurrent
/// cancel and config changes during an in-flight prompt.
pub(crate) async fn agent_command_loop(
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
                    if text.len() > 100 {
                        &text[..100]
                    } else {
                        &text
                    }
                );

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
                                thread_id: agent_id.clone(),
                                stop_reason,
                            }));
                        let _ = reply.send(Ok(()));
                    }
                    Err(e) => {
                        log::error!("Agent {} prompt failed: {}", &agent_id, e);
                        let msg = format!("Prompt failed: {}", e);
                        let _ = event_tx.send(Notification::Error(ThreadErrorPayload {
                            thread_id: agent_id.clone(),
                            message: msg.clone(),
                        }));
                        let _ = reply.send(Err(msg));
                    }
                }
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
                log::debug!("Agent {} set_config: {} = {}", &agent_id, config_id, value);
                let req =
                    acp::SetSessionConfigOptionRequest::new(session_id.clone(), config_id, value);
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
