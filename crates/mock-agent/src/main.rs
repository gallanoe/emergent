//! A mock ACP agent for testing. Behavior is prompt-driven:
//!
//! - Default: echoes prompt back in 3-4 message chunks
//! - "use tools": emits a ToolCall, then a message
//! - "think first": emits thinking chunks, then a message
//! - "slow response": chunks with 200ms delay
//! - "error": returns an ACP error
//! - "long response": streams many chunks
//! - "request permission": triggers a permission request callback

use std::cell::{Cell, RefCell};

use agent_client_protocol::{self as acp, Client as _};
use tokio::sync::{mpsc, oneshot};
use tokio_util::compat::{TokioAsyncReadCompatExt as _, TokioAsyncWriteCompatExt as _};

struct MockAgent {
    notify_tx: mpsc::UnboundedSender<(acp::SessionNotification, oneshot::Sender<()>)>,
    next_session_id: Cell<u64>,
    model: RefCell<String>,
    thinking: RefCell<String>,
}

impl MockAgent {
    fn new(
        notify_tx: mpsc::UnboundedSender<(acp::SessionNotification, oneshot::Sender<()>)>,
    ) -> Self {
        Self {
            notify_tx,
            next_session_id: Cell::new(0),
            model: RefCell::new("sonnet-4".into()),
            thinking: RefCell::new("high".into()),
        }
    }

    fn build_config_options(&self) -> Vec<acp::SessionConfigOption> {
        let model = self.model.borrow().clone();
        let thinking = self.thinking.borrow().clone();
        vec![
            acp::SessionConfigOption::select(
                "model",
                "Model",
                model,
                vec![
                    acp::SessionConfigSelectOption::new("opus-4", "Opus 4"),
                    acp::SessionConfigSelectOption::new("sonnet-4", "Sonnet 4"),
                    acp::SessionConfigSelectOption::new("haiku-3.5", "Haiku 3.5"),
                ],
            )
            .category(acp::SessionConfigOptionCategory::Model),
            acp::SessionConfigOption::select(
                "thinking",
                "Thinking",
                thinking,
                vec![
                    acp::SessionConfigSelectOption::new("off", "Off"),
                    acp::SessionConfigSelectOption::new("low", "Low"),
                    acp::SessionConfigSelectOption::new("high", "High"),
                ],
            )
            .category(acp::SessionConfigOptionCategory::ThoughtLevel),
        ]
    }

    fn send_notification(
        &self,
        session_id: &acp::SessionId,
        update: acp::SessionUpdate,
    ) -> Result<oneshot::Receiver<()>, acp::Error> {
        let (tx, rx) = oneshot::channel();
        self.notify_tx
            .send((
                acp::SessionNotification::new(session_id.clone(), update),
                tx,
            ))
            .map_err(|_| acp::Error::internal_error())?;
        Ok(rx)
    }

    fn send_message_chunk(
        &self,
        session_id: &acp::SessionId,
        text: &str,
    ) -> Result<oneshot::Receiver<()>, acp::Error> {
        self.send_notification(
            session_id,
            acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new(text.into())),
        )
    }

    fn send_thinking_chunk(
        &self,
        session_id: &acp::SessionId,
        text: &str,
    ) -> Result<oneshot::Receiver<()>, acp::Error> {
        self.send_notification(
            session_id,
            acp::SessionUpdate::AgentThoughtChunk(acp::ContentChunk::new(text.into())),
        )
    }
}

#[async_trait::async_trait(?Send)]
impl acp::Agent for MockAgent {
    async fn initialize(
        &self,
        _args: acp::InitializeRequest,
    ) -> Result<acp::InitializeResponse, acp::Error> {
        Ok(acp::InitializeResponse::new(acp::ProtocolVersion::V1)
            .agent_info(acp::Implementation::new("mock-agent", "0.1.0").title("Mock Agent")))
    }

    async fn authenticate(
        &self,
        _args: acp::AuthenticateRequest,
    ) -> Result<acp::AuthenticateResponse, acp::Error> {
        Ok(acp::AuthenticateResponse::default())
    }

    async fn new_session(
        &self,
        _args: acp::NewSessionRequest,
    ) -> Result<acp::NewSessionResponse, acp::Error> {
        let id = self.next_session_id.get();
        self.next_session_id.set(id + 1);
        Ok(
            acp::NewSessionResponse::new(id.to_string())
                .config_options(self.build_config_options()),
        )
    }

    async fn set_session_config_option(
        &self,
        args: acp::SetSessionConfigOptionRequest,
    ) -> Result<acp::SetSessionConfigOptionResponse, acp::Error> {
        let config_id = args.config_id.to_string();
        let value = args.value.to_string();

        match config_id.as_str() {
            "model" => *self.model.borrow_mut() = value,
            "thinking" => *self.thinking.borrow_mut() = value,
            _ => return Err(acp::Error::invalid_params()),
        }

        Ok(acp::SetSessionConfigOptionResponse::new(
            self.build_config_options(),
        ))
    }

    async fn prompt(&self, args: acp::PromptRequest) -> Result<acp::PromptResponse, acp::Error> {
        // Extract prompt text
        let text = args
            .prompt
            .iter()
            .filter_map(|c| match c {
                acp::ContentBlock::Text(tc) => Some(tc.text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(" ");

        let text_lower = text.to_lowercase();

        if text_lower.contains("error") {
            return Err(acp::Error::internal_error());
        }

        if text_lower.contains("think first") {
            // Emit thinking chunks, then message
            self.send_thinking_chunk(&args.session_id, "Let me think about this...")
                .map_err(|_| acp::Error::internal_error())?
                .await
                .map_err(|_| acp::Error::internal_error())?;
            self.send_thinking_chunk(&args.session_id, " I need to consider the options.")
                .map_err(|_| acp::Error::internal_error())?
                .await
                .map_err(|_| acp::Error::internal_error())?;
            self.send_message_chunk(&args.session_id, "After thinking, here is my response.")
                .map_err(|_| acp::Error::internal_error())?
                .await
                .map_err(|_| acp::Error::internal_error())?;
        } else if text_lower.contains("use tools") {
            // Emit a tool call, then a message
            let tool_call_id = acp::ToolCallId::new("tc-001");
            self.send_notification(
                &args.session_id,
                acp::SessionUpdate::ToolCall(
                    acp::ToolCall::new(tool_call_id.clone(), "Read file")
                        .status(acp::ToolCallStatus::Pending),
                ),
            )
            .map_err(|_| acp::Error::internal_error())?
            .await
            .map_err(|_| acp::Error::internal_error())?;

            let fields = acp::ToolCallUpdateFields::new().status(acp::ToolCallStatus::Completed);
            self.send_notification(
                &args.session_id,
                acp::SessionUpdate::ToolCallUpdate(acp::ToolCallUpdate::new(tool_call_id, fields)),
            )
            .map_err(|_| acp::Error::internal_error())?
            .await
            .map_err(|_| acp::Error::internal_error())?;

            self.send_message_chunk(&args.session_id, "I read the file successfully.")
                .map_err(|_| acp::Error::internal_error())?
                .await
                .map_err(|_| acp::Error::internal_error())?;
        } else if text_lower.contains("slow response") {
            // Chunks with delay
            for chunk in ["Slow ", "response ", "coming ", "through."] {
                self.send_message_chunk(&args.session_id, chunk)
                    .map_err(|_| acp::Error::internal_error())?
                    .await
                    .map_err(|_| acp::Error::internal_error())?;
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
        } else if text_lower.contains("long response") {
            // Many chunks
            for i in 0..20 {
                self.send_message_chunk(
                    &args.session_id,
                    &format!("Chunk {} of a long response. ", i + 1),
                )
                .map_err(|_| acp::Error::internal_error())?
                .await
                .map_err(|_| acp::Error::internal_error())?;
            }
        } else {
            // Default: echo back in chunks
            let response = format!("Echo: {}", text);
            let chunk_size = (response.len() / 3).max(1);
            for chunk in response.as_bytes().chunks(chunk_size) {
                let s = String::from_utf8_lossy(chunk);
                self.send_message_chunk(&args.session_id, &s)
                    .map_err(|_| acp::Error::internal_error())?
                    .await
                    .map_err(|_| acp::Error::internal_error())?;
            }
        }

        Ok(acp::PromptResponse::new(acp::StopReason::EndTurn))
    }

    async fn cancel(&self, _args: acp::CancelNotification) -> Result<(), acp::Error> {
        Ok(())
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> acp::Result<()> {
    env_logger::init();

    let outgoing = tokio::io::stdout().compat_write();
    let incoming = tokio::io::stdin().compat();

    let local_set = tokio::task::LocalSet::new();
    local_set
        .run_until(async move {
            let (tx, mut rx) = mpsc::unbounded_channel();
            let (conn, handle_io) =
                acp::AgentSideConnection::new(MockAgent::new(tx), outgoing, incoming, |fut| {
                    tokio::task::spawn_local(fut);
                });

            // Background task to forward notifications to client
            tokio::task::spawn_local(async move {
                while let Some((notification, done_tx)) = rx.recv().await {
                    let result = conn.session_notification(notification).await;
                    if let Err(e) = result {
                        log::error!("Failed to send notification: {e}");
                        break;
                    }
                    done_tx.send(()).ok();
                }
            });

            handle_io.await
        })
        .await
}
