use agent_client_protocol as acp;
use agent_client_protocol::schema::{
    CancelNotification, ConfigOptionUpdate, ContentBlock, PromptRequest,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionUpdate, SetSessionConfigOptionRequest, ToolCallContent,
    ToolCallLocation, ToolKind,
};
use emergent_protocol::{
    ConfigOption, ConfigUpdatePayload, MessageChunkPayload, Notification, PromptCompletePayload,
    ThreadErrorPayload, ThreadTokenUsagePayload, ToolCallContentPayload, ToolCallEventPayload,
    TurnUsagePayload, UserMessagePayload,
};
use tokio::sync::{broadcast, mpsc};

use super::AgentCommand;

// ---------------------------------------------------------------------------
// Helper methods for extracting payload fields from schema types
// ---------------------------------------------------------------------------

pub(crate) fn tool_call_status_str(status: &acp::schema::ToolCallStatus) -> String {
    serde_json::to_value(status)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| format!("{:?}", status))
}

pub(crate) fn extract_tool_call_content(
    content: &[ToolCallContent],
) -> Option<Vec<ToolCallContentPayload>> {
    if content.is_empty() {
        return None;
    }
    let items: Vec<ToolCallContentPayload> = content
        .iter()
        .map(|c| match c {
            ToolCallContent::Content(inner) => ToolCallContentPayload::Text {
                text: extract_text(&inner.content),
            },
            ToolCallContent::Diff(diff) => ToolCallContentPayload::Diff {
                path: diff.path.display().to_string(),
                old_text: diff.old_text.clone(),
                new_text: diff.new_text.clone(),
            },
            ToolCallContent::Terminal(term) => ToolCallContentPayload::Terminal {
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

pub(crate) fn extract_locations(locations: &[ToolCallLocation]) -> Option<Vec<String>> {
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

pub(crate) fn tool_kind_str(kind: &ToolKind) -> String {
    serde_json::to_value(kind)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| "other".into())
}

pub(crate) fn extract_text(content: &ContentBlock) -> String {
    match content {
        ContentBlock::Text(tc) => tc.text.clone(),
        ContentBlock::Image(_) => "[image]".into(),
        ContentBlock::Audio(_) => "[audio]".into(),
        ContentBlock::ResourceLink(rl) => rl.uri.clone(),
        ContentBlock::Resource(_) => "[resource]".into(),
        _ => "[unknown content]".into(),
    }
}

/// Process a single `SessionUpdate` notification and emit zero or more
/// `emergent_protocol::Notification` events on the broadcast channel.
pub(crate) fn handle_session_update(
    agent_id: &str,
    update: SessionUpdate,
    event_tx: &broadcast::Sender<Notification>,
    config: &std::sync::Arc<std::sync::Mutex<Vec<ConfigOption>>>,
) {
    match update {
        SessionUpdate::AgentMessageChunk(chunk) => {
            let text = extract_text(&chunk.content);
            let _ = event_tx.send(Notification::MessageChunk(MessageChunkPayload {
                thread_id: agent_id.to_string(),
                content: text,
                kind: "message".into(),
            }));
        }
        SessionUpdate::ToolCall(tc) => {
            log::debug!(
                "Agent {} tool call: {} (id: {}, status: {:?})",
                agent_id,
                tc.title,
                tc.tool_call_id,
                tc.status
            );
            let _ = event_tx.send(Notification::ToolCallUpdate(ToolCallEventPayload {
                thread_id: agent_id.to_string(),
                tool_call_id: tc.tool_call_id.to_string(),
                title: Some(tc.title.clone()),
                kind: Some(tool_kind_str(&tc.kind)),
                status: Some(tool_call_status_str(&tc.status)),
                locations: extract_locations(&tc.locations),
                content: extract_tool_call_content(&tc.content),
                raw_input: tc.raw_input.clone(),
                raw_output: tc.raw_output.clone(),
            }));
        }
        SessionUpdate::ToolCallUpdate(tcu) => {
            let _ = event_tx.send(Notification::ToolCallUpdate(ToolCallEventPayload {
                thread_id: agent_id.to_string(),
                tool_call_id: tcu.tool_call_id.to_string(),
                title: tcu.fields.title.clone(),
                kind: tcu.fields.kind.map(|k| tool_kind_str(&k)),
                status: tcu.fields.status.map(|s| tool_call_status_str(&s)),
                locations: tcu
                    .fields
                    .locations
                    .as_ref()
                    .and_then(|l| extract_locations(l)),
                content: tcu
                    .fields
                    .content
                    .as_ref()
                    .and_then(|c| extract_tool_call_content(c)),
                raw_input: tcu.fields.raw_input.clone(),
                raw_output: tcu.fields.raw_output.clone(),
            }));
        }
        SessionUpdate::UserMessageChunk(chunk) => {
            let text = extract_text(&chunk.content);
            let _ = event_tx.send(Notification::UserMessage(UserMessagePayload {
                thread_id: agent_id.to_string(),
                content: text,
            }));
        }
        SessionUpdate::AgentThoughtChunk(chunk) => {
            let text = extract_text(&chunk.content);
            let _ = event_tx.send(Notification::MessageChunk(MessageChunkPayload {
                thread_id: agent_id.to_string(),
                content: text,
                kind: "thinking".into(),
            }));
        }
        SessionUpdate::Plan(plan) => {
            for (i, entry) in plan.entries.iter().enumerate() {
                log::debug!(
                    "Agent {} plan[{}]: [{:?}] {:?} — {}",
                    agent_id,
                    i,
                    entry.status,
                    entry.priority,
                    entry.content
                );
            }
        }
        SessionUpdate::ConfigOptionUpdate(ConfigOptionUpdate {
            config_options, ..
        }) => {
            let new_config = crate::config::convert_config_options(&config_options);
            let old_config = {
                let mut guard = config.lock().unwrap();
                let old = guard.clone();
                *guard = new_config.clone();
                old
            };
            let changes = crate::config::diff_config(&old_config, &new_config);
            let _ = event_tx.send(Notification::ConfigUpdate(ConfigUpdatePayload {
                thread_id: agent_id.to_string(),
                config_options: new_config,
                changes,
            }));
        }
        SessionUpdate::UsageUpdate(u) => {
            let _ = event_tx.send(Notification::TokenUsage(ThreadTokenUsagePayload {
                thread_id: agent_id.to_string(),
                used_tokens: u.used,
                context_size: u.size,
                cost_amount: u.cost.as_ref().map(|c| c.amount),
                cost_currency: u.cost.as_ref().map(|c| c.currency.clone()),
            }));
        }
        _ => {
            // AvailableCommandsUpdate and other future variants — ignored for v1
        }
    }
}

/// Build the permission-approval response for a `RequestPermissionRequest`.
/// Auto-approves by selecting the first option if available, otherwise cancels.
pub(crate) fn build_permission_response(
    args: &RequestPermissionRequest,
) -> RequestPermissionResponse {
    let outcome = if let Some(first) = args.options.first() {
        RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
            first.option_id.clone(),
        ))
    } else {
        RequestPermissionOutcome::Cancelled
    };
    RequestPermissionResponse::new(outcome)
}

// ---------------------------------------------------------------------------
// ACP command loop — runs on the dedicated ACP thread
// ---------------------------------------------------------------------------

/// Process commands from the main thread on the ACP thread.
/// Handles prompt/cancel/config/shutdown while supporting concurrent
/// cancel and config changes during an in-flight prompt.
pub(crate) async fn agent_command_loop(
    conn: acp::ConnectionTo<acp::Agent>,
    session_id: acp::schema::SessionId,
    mut command_rx: mpsc::UnboundedReceiver<AgentCommand>,
    agent_id: String,
    event_tx: broadcast::Sender<Notification>,
    workspace_id: String,
    agent_definition_id: String,
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

                let prompt_req = PromptRequest::new(
                    session_id.clone(),
                    vec![acp::schema::ContentBlock::Text(
                        acp::schema::TextContent::new(text),
                    )],
                );

                // Use select! so cancel commands are handled immediately
                // while the prompt is in-flight.
                let prompt_fut = conn.send_request(prompt_req).block_task();
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
                                    let cancel = CancelNotification::new(session_id.clone());
                                    match conn.send_notification(cancel) {
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
                                    let req = SetSessionConfigOptionRequest::new(
                                        session_id.clone(),
                                        config_id,
                                        value.as_str(),
                                    );
                                    match conn.send_request(req).block_task().await {
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

                        // Emit per-turn usage if the agent reported it.
                        // No cfg gate needed: "unstable" feature is always active
                        // at workspace level and emergent-core has no features table.
                        if let Some(usage) = resp.usage {
                            let _ = event_tx.send(Notification::TurnUsage(TurnUsagePayload {
                                thread_id: agent_id.clone(),
                                workspace_id: workspace_id.clone(),
                                agent_definition_id: agent_definition_id.clone(),
                                input_tokens: usage.input_tokens,
                                output_tokens: usage.output_tokens,
                                cached_read_tokens: usage.cached_read_tokens.unwrap_or(0),
                                cached_write_tokens: usage.cached_write_tokens.unwrap_or(0),
                                thought_tokens: usage.thought_tokens.unwrap_or(0),
                                total_tokens: usage.total_tokens,
                                at: chrono::Utc::now().to_rfc3339(),
                            }));
                        }

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
                let cancel = CancelNotification::new(session_id.clone());
                match conn.send_notification(cancel) {
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
                let req = SetSessionConfigOptionRequest::new(
                    session_id.clone(),
                    config_id,
                    value.as_str(),
                );
                match conn.send_request(req).block_task().await {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::UsageUpdate;
    use tokio::sync::broadcast;

    #[test]
    fn usage_update_emits_token_usage_notification() {
        let (tx, mut rx) = broadcast::channel(8);
        let config = std::sync::Arc::new(std::sync::Mutex::new(vec![]));
        {
            let update = SessionUpdate::UsageUpdate(UsageUpdate::new(12_340, 200_000));
            handle_session_update("thread-1", update, &tx, &config);
            let n = rx.try_recv().expect("notification sent");
            match n {
                Notification::TokenUsage(p) => {
                    assert_eq!(p.thread_id, "thread-1");
                    assert_eq!(p.used_tokens, 12_340);
                    assert_eq!(p.context_size, 200_000);
                    assert!(p.cost_amount.is_none());
                }
                _ => panic!("expected TokenUsage"),
            }
        }
    }
}
