#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::time::SystemTime;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum Role {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ToolResult {
    pub tool_call_id: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MessageMetadata {
    pub id: String,
    pub timestamp: SystemTime,
    pub model: Option<String>,
    pub token_count: Option<u32>,
}

impl MessageMetadata {
    fn new() -> Self {
        Self {
            id: nanoid::nanoid!(),
            timestamp: SystemTime::now(),
            model: None,
            token_count: None,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChatMessage {
    role: Role,
    content: Option<String>,
    tool_calls: Option<Vec<ToolCall>>,
    tool_result: Option<ToolResult>,
    metadata: MessageMetadata,
}

impl ChatMessage {
    pub fn system(content: &str) -> Self {
        Self {
            role: Role::System,
            content: Some(content.to_string()),
            tool_calls: None,
            tool_result: None,
            metadata: MessageMetadata::new(),
        }
    }

    pub fn user(content: &str) -> Self {
        Self {
            role: Role::User,
            content: Some(content.to_string()),
            tool_calls: None,
            tool_result: None,
            metadata: MessageMetadata::new(),
        }
    }

    pub fn assistant(content: &str) -> Self {
        Self {
            role: Role::Assistant,
            content: Some(content.to_string()),
            tool_calls: None,
            tool_result: None,
            metadata: MessageMetadata::new(),
        }
    }

    pub fn assistant_tool_calls(calls: Vec<ToolCall>) -> Self {
        Self {
            role: Role::Assistant,
            content: None,
            tool_calls: Some(calls),
            tool_result: None,
            metadata: MessageMetadata::new(),
        }
    }

    pub fn assistant_with_tool_calls(content: &str, calls: Vec<ToolCall>) -> Self {
        Self {
            role: Role::Assistant,
            content: Some(content.to_string()),
            tool_calls: Some(calls),
            tool_result: None,
            metadata: MessageMetadata::new(),
        }
    }

    pub fn tool_result(tool_call_id: &str, content: &str) -> Self {
        Self {
            role: Role::Tool,
            content: None,
            tool_calls: None,
            tool_result: Some(ToolResult {
                tool_call_id: tool_call_id.to_string(),
                content: content.to_string(),
            }),
            metadata: MessageMetadata::new(),
        }
    }

    pub fn role(&self) -> &Role {
        &self.role
    }

    pub fn content(&self) -> Option<&str> {
        self.content.as_deref()
    }

    pub fn tool_calls(&self) -> Option<&[ToolCall]> {
        self.tool_calls.as_deref()
    }

    pub fn get_tool_result(&self) -> Option<&ToolResult> {
        self.tool_result.as_ref()
    }

    pub fn metadata(&self) -> &MessageMetadata {
        &self.metadata
    }
}

#[derive(Debug, Clone, Default)]
pub struct Conversation {
    messages: Vec<ChatMessage>,
}

impl Conversation {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, message: ChatMessage) {
        self.messages.push(message);
    }

    pub fn messages(&self) -> &[ChatMessage] {
        &self.messages
    }

    pub fn last_assistant_message(&self) -> Option<&ChatMessage> {
        self.messages
            .iter()
            .rev()
            .find(|m| m.role == Role::Assistant)
    }

    pub fn len(&self) -> usize {
        self.messages.len()
    }

    pub fn is_empty(&self) -> bool {
        self.messages.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_message_has_correct_role_and_content() {
        let msg = ChatMessage::system("you are helpful");
        assert_eq!(*msg.role(), Role::System);
        assert_eq!(msg.content(), Some("you are helpful"));
        assert!(msg.tool_calls().is_none());
        assert!(msg.get_tool_result().is_none());
    }

    #[test]
    fn user_message_has_correct_role_and_content() {
        let msg = ChatMessage::user("hello");
        assert_eq!(*msg.role(), Role::User);
        assert_eq!(msg.content(), Some("hello"));
    }

    #[test]
    fn assistant_message_has_correct_role_and_content() {
        let msg = ChatMessage::assistant("response");
        assert_eq!(*msg.role(), Role::Assistant);
        assert_eq!(msg.content(), Some("response"));
        assert!(msg.tool_calls().is_none());
    }

    #[test]
    fn assistant_tool_calls_message_has_calls_and_no_content() {
        let calls = vec![ToolCall {
            id: "1".into(),
            name: "echo".into(),
            arguments: serde_json::json!({"text": "hi"}),
        }];
        let msg = ChatMessage::assistant_tool_calls(calls);
        assert_eq!(*msg.role(), Role::Assistant);
        assert!(msg.content().is_none());
        assert_eq!(msg.tool_calls().unwrap().len(), 1);
    }

    #[test]
    fn assistant_with_tool_calls_has_both_content_and_calls() {
        let calls = vec![ToolCall {
            id: "1".into(),
            name: "echo".into(),
            arguments: serde_json::json!({}),
        }];
        let msg = ChatMessage::assistant_with_tool_calls("thinking...", calls);
        assert_eq!(msg.content(), Some("thinking..."));
        assert_eq!(msg.tool_calls().unwrap().len(), 1);
    }

    #[test]
    fn tool_result_message_has_correct_role_and_result() {
        let msg = ChatMessage::tool_result("call_1", "result data");
        assert_eq!(*msg.role(), Role::Tool);
        let result = msg.get_tool_result().unwrap();
        assert_eq!(result.tool_call_id, "call_1");
        assert_eq!(result.content, "result data");
    }

    #[test]
    fn metadata_has_id_and_timestamp() {
        let msg = ChatMessage::user("test");
        assert!(!msg.metadata().id.is_empty());
    }

    #[test]
    fn conversation_starts_empty() {
        let conv = Conversation::new();
        assert!(conv.is_empty());
        assert_eq!(conv.len(), 0);
    }

    #[test]
    fn conversation_push_and_retrieve() {
        let mut conv = Conversation::new();
        conv.push(ChatMessage::user("hi"));
        conv.push(ChatMessage::assistant("hello"));
        assert_eq!(conv.len(), 2);
        assert_eq!(conv.messages().len(), 2);
    }

    #[test]
    fn last_assistant_message_finds_most_recent() {
        let mut conv = Conversation::new();
        conv.push(ChatMessage::user("hi"));
        conv.push(ChatMessage::assistant("first"));
        conv.push(ChatMessage::user("again"));
        conv.push(ChatMessage::assistant("second"));

        let last = conv.last_assistant_message().unwrap();
        assert_eq!(last.content(), Some("second"));
    }

    #[test]
    fn last_assistant_message_returns_none_when_no_assistant() {
        let mut conv = Conversation::new();
        conv.push(ChatMessage::user("hi"));
        assert!(conv.last_assistant_message().is_none());
    }

    #[test]
    fn conversation_default_is_empty() {
        let conv = Conversation::default();
        assert!(conv.is_empty());
    }
}
