//! A mock ACP agent for testing. Behavior is prompt-driven:
//!
//! - Default: echoes prompt back in 3-4 message chunks
//! - "use tools": emits a ToolCall, then a message
//! - "think first": emits thinking chunks, then a message
//! - "slow response": chunks with 200ms delay
//! - "error": returns an ACP error
//! - "long response": streams many chunks
//! - "usage": emits a UsageUpdate (12_340 / 200_000) then a message
//! - "request permission": triggers a permission request callback

use std::sync::{Arc, Mutex};

use agent_client_protocol as acp;
use agent_client_protocol::schema::{
    AgentCapabilities, ContentBlock, ContentChunk, InitializeRequest, InitializeResponse,
    Implementation, NewSessionRequest, NewSessionResponse, PromptRequest, PromptResponse,
    SessionConfigOption, SessionConfigOptionCategory,
    SessionConfigOptionValue, SessionConfigSelectOption, SessionId, SessionNotification,
    SessionUpdate, SetSessionConfigOptionRequest, SetSessionConfigOptionResponse, StopReason,
    ToolCall, ToolCallId, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, Usage, UsageUpdate,
};
use tokio_util::compat::{TokioAsyncReadCompatExt as _, TokioAsyncWriteCompatExt as _};

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

struct MockState {
    next_session_id: u64,
    model: String,
    thinking: String,
}

impl MockState {
    fn new() -> Self {
        Self {
            next_session_id: 0,
            model: "sonnet-4".into(),
            thinking: "high".into(),
        }
    }

    fn build_config_options(&self) -> Vec<SessionConfigOption> {
        let model = self.model.clone();
        let thinking = self.thinking.clone();
        vec![
            SessionConfigOption::select(
                "model",
                "Model",
                model,
                vec![
                    SessionConfigSelectOption::new("opus-4", "Opus 4"),
                    SessionConfigSelectOption::new("sonnet-4", "Sonnet 4"),
                    SessionConfigSelectOption::new("haiku-3.5", "Haiku 3.5"),
                ],
            )
            .category(SessionConfigOptionCategory::Model),
            SessionConfigOption::select(
                "thinking",
                "Thinking",
                thinking,
                vec![
                    SessionConfigSelectOption::new("off", "Off"),
                    SessionConfigSelectOption::new("low", "Low"),
                    SessionConfigSelectOption::new("high", "High"),
                ],
            )
            .category(SessionConfigOptionCategory::ThoughtLevel),
        ]
    }
}

// ---------------------------------------------------------------------------
// Notification helpers
// ---------------------------------------------------------------------------

fn send_session_update(
    cx: &acp::ConnectionTo<acp::Client>,
    session_id: &SessionId,
    update: SessionUpdate,
) -> acp::schema::Result<()> {
    cx.send_notification(SessionNotification::new(session_id.clone(), update))
        .map_err(|e| acp::schema::Error::internal_error().data(e.to_string()))
}

fn send_message_chunk(
    cx: &acp::ConnectionTo<acp::Client>,
    session_id: &SessionId,
    text: &str,
) -> acp::schema::Result<()> {
    send_session_update(
        cx,
        session_id,
        SessionUpdate::AgentMessageChunk(ContentChunk::new(text.into())),
    )
}

fn send_thinking_chunk(
    cx: &acp::ConnectionTo<acp::Client>,
    session_id: &SessionId,
    text: &str,
) -> acp::schema::Result<()> {
    send_session_update(
        cx,
        session_id,
        SessionUpdate::AgentThoughtChunk(ContentChunk::new(text.into())),
    )
}

/// Extract a string value from `SessionConfigOptionValue`.
/// With `unstable_boolean_config` enabled, the value is an enum; extract the
/// `ValueId` string or fall back to the debug representation.
fn config_value_to_string(value: &SessionConfigOptionValue) -> String {
    match value {
        SessionConfigOptionValue::ValueId { value: id } => id.to_string(),
        // Boolean variant is gated on unstable_boolean_config — include a
        // catch-all to handle any future variants gracefully.
        _ => {
            log::warn!("Unexpected SessionConfigOptionValue variant in mock agent");
            String::new()
        }
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main(flavor = "current_thread")]
async fn main() -> acp::schema::Result<()> {
    env_logger::init();

    let outgoing = tokio::io::stdout().compat_write();
    let incoming = tokio::io::stdin().compat();
    let transport = acp::ByteStreams::new(outgoing, incoming);

    let state = Arc::new(Mutex::new(MockState::new()));

    let state_new = state.clone();
    let state_set_config = state.clone();

    acp::Agent
        .builder()
        .name("mock-agent")
        .on_receive_request(
            async move |_req: InitializeRequest,
                        responder: acp::Responder<InitializeResponse>,
                        _cx: acp::ConnectionTo<acp::Client>| {
                let _ = responder.respond(
                    InitializeResponse::new(acp::schema::ProtocolVersion::V1)
                        .agent_info(
                            Implementation::new("mock-agent", "0.1.0").title("Mock Agent"),
                        )
                        .agent_capabilities(AgentCapabilities::new()),
                );
                Ok(())
            },
            acp::on_receive_request!(),
        )
        .on_receive_request(
            async move |_req: NewSessionRequest,
                        responder: acp::Responder<NewSessionResponse>,
                        _cx: acp::ConnectionTo<acp::Client>| {
                let (session_id, config_options) = {
                    let mut st = state_new.lock().unwrap();
                    let id = st.next_session_id;
                    st.next_session_id += 1;
                    let config = st.build_config_options();
                    (id.to_string(), config)
                };
                let _ = responder
                    .respond(NewSessionResponse::new(session_id).config_options(config_options));
                Ok(())
            },
            acp::on_receive_request!(),
        )
        .on_receive_request(
            async move |args: SetSessionConfigOptionRequest,
                        responder: acp::Responder<SetSessionConfigOptionResponse>,
                        _cx: acp::ConnectionTo<acp::Client>| {
                let config_id = args.config_id.to_string();
                let value_str = config_value_to_string(&args.value);
                let result = {
                    let mut st = state_set_config.lock().unwrap();
                    match config_id.as_str() {
                        "model" => {
                            st.model = value_str;
                            Ok(st.build_config_options())
                        }
                        "thinking" => {
                            st.thinking = value_str;
                            Ok(st.build_config_options())
                        }
                        _ => Err(acp::schema::Error::invalid_params()),
                    }
                };
                match result {
                    Ok(config_options) => {
                        let _ = responder
                            .respond(SetSessionConfigOptionResponse::new(config_options));
                    }
                    Err(e) => {
                        let _ = responder.respond_with_error(e);
                    }
                }
                Ok(())
            },
            acp::on_receive_request!(),
        )
        .on_receive_request(
            async move |args: PromptRequest,
                        responder: acp::Responder<PromptResponse>,
                        cx: acp::ConnectionTo<acp::Client>| {
                let session_id = args.session_id.clone();

                // Extract prompt text
                let text = args
                    .prompt
                    .iter()
                    .filter_map(|c| match c {
                        ContentBlock::Text(tc) => Some(tc.text.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join(" ");

                let text_lower = text.to_lowercase();

                if text_lower.contains("error") {
                    let _ = responder.respond_with_error(acp::schema::Error::internal_error());
                    return Ok(());
                }

                if text_lower.contains("think first") {
                    // Emit thinking chunks, then message
                    send_thinking_chunk(&cx, &session_id, "Let me think about this...")?;
                    send_thinking_chunk(&cx, &session_id, " I need to consider the options.")?;
                    send_message_chunk(&cx, &session_id, "After thinking, here is my response.")?;
                } else if text_lower.contains("use tools") {
                    // Emit a tool call, then a message
                    let tool_call_id = ToolCallId::new("tc-001");
                    send_session_update(
                        &cx,
                        &session_id,
                        SessionUpdate::ToolCall(
                            ToolCall::new(tool_call_id.clone(), "Read file")
                                .status(ToolCallStatus::Pending),
                        ),
                    )?;

                    let fields = ToolCallUpdateFields::new().status(ToolCallStatus::Completed);
                    send_session_update(
                        &cx,
                        &session_id,
                        SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(tool_call_id, fields)),
                    )?;

                    send_message_chunk(&cx, &session_id, "I read the file successfully.")?;
                } else if text_lower.contains("slow response") {
                    // Chunks with delay
                    for chunk in ["Slow ", "response ", "coming ", "through."] {
                        send_message_chunk(&cx, &session_id, chunk)?;
                        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    }
                } else if text_lower.contains("usage") {
                    // Emit a UsageUpdate then echo back. Also attach Usage to the
                    // PromptResponse so the acp_bridge extraction path is exercised.
                    send_session_update(
                        &cx,
                        &session_id,
                        SessionUpdate::UsageUpdate(UsageUpdate::new(12_340, 200_000)),
                    )?;
                    send_message_chunk(&cx, &session_id, "Usage event emitted.")?;
                    let usage = Usage::new(1480, 1200, 280);
                    let _ = responder.respond(
                        PromptResponse::new(StopReason::EndTurn).usage(usage),
                    );
                    return Ok(());
                } else if text_lower.contains("long response") {
                    // Many chunks
                    for i in 0..20 {
                        send_message_chunk(
                            &cx,
                            &session_id,
                            &format!("Chunk {} of a long response. ", i + 1),
                        )?;
                    }
                } else {
                    // Default: echo back in chunks
                    let response = format!("Echo: {}", text);
                    let chunk_size = (response.len() / 3).max(1);
                    for chunk in response.as_bytes().chunks(chunk_size) {
                        let s = String::from_utf8_lossy(chunk);
                        send_message_chunk(&cx, &session_id, &s)?;
                    }
                }

                let _ = responder.respond(PromptResponse::new(StopReason::EndTurn));
                Ok(())
            },
            acp::on_receive_request!(),
        )
        .on_receive_dispatch(
            async move |message: acp::Dispatch, cx: acp::ConnectionTo<acp::Client>| {
                // Handle cancel notifications (fire-and-forget, no response needed).
                // For any unrecognized requests, respond with method_not_found.
                message.respond_with_error(acp::schema::Error::method_not_found(), cx)
            },
            acp::on_receive_dispatch!(),
        )
        .connect_to(transport)
        .await
}
