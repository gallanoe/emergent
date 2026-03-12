#![allow(dead_code)]

use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::agent::conversation::{Conversation, ToolCall};
use crate::agent::tools::ToolRegistry;

#[derive(Clone, Debug)]
pub struct LlmClientConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub max_tokens: u32,
    pub temperature: f32,
    pub system_prompt: Option<String>,
}

#[derive(Clone, Debug)]
pub enum StreamEvent {
    Token(String),
    ToolCallStart {
        index: u32,
        id: String,
        name: String,
    },
    ToolCallArgDelta {
        index: u32,
        arguments: String,
    },
    ToolCallComplete(ToolCall),
    Done {
        stop_reason: Option<String>,
    },
    Error(String),
}

#[async_trait]
pub trait LlmClient: Send + Sync {
    fn config(&self) -> &LlmClientConfig;

    async fn chat_stream(
        &self,
        conversation: &Conversation,
        tools: Option<&ToolRegistry>,
    ) -> eyre::Result<mpsc::Receiver<StreamEvent>>;

    fn model(&self) -> &str {
        &self.config().model
    }
}
