#![allow(dead_code)]

use async_trait::async_trait;
use eyre::eyre;
use std::collections::HashMap;

use crate::agent::conversation::ToolCall;

#[async_trait]
pub trait ToolHandler: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> serde_json::Value;
    async fn execute(&self, args: serde_json::Value) -> eyre::Result<String>;
}

#[derive(Default)]
pub struct ToolRegistry {
    handlers: HashMap<String, Box<dyn ToolHandler>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, handler: impl ToolHandler + 'static) {
        self.handlers
            .insert(handler.name().to_string(), Box::new(handler));
    }

    pub fn get(&self, name: &str) -> Option<&dyn ToolHandler> {
        self.handlers.get(name).map(|h| h.as_ref())
    }

    pub async fn execute(&self, tool_call: &ToolCall) -> eyre::Result<String> {
        let handler = self
            .handlers
            .get(&tool_call.name)
            .ok_or_else(|| eyre!("Unknown tool: {}", tool_call.name))?;
        handler.execute(tool_call.arguments.clone()).await
    }

    pub fn is_empty(&self) -> bool {
        self.handlers.is_empty()
    }

    pub fn tool_definitions(&self) -> Vec<(&str, &str, serde_json::Value)> {
        self.handlers
            .values()
            .map(|h| (h.name(), h.description(), h.parameters_schema()))
            .collect()
    }
}

pub struct EchoTool;

#[async_trait]
impl ToolHandler for EchoTool {
    fn name(&self) -> &str {
        "echo"
    }

    fn description(&self) -> &str {
        "Echoes back the provided arguments as a JSON string"
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "The message to echo back"
                }
            },
            "required": ["message"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> eyre::Result<String> {
        Ok(serde_json::to_string_pretty(&args)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::conversation::ToolCall;

    #[tokio::test]
    async fn echo_tool_returns_pretty_json() {
        let tool = EchoTool;
        let args = serde_json::json!({"message": "hello"});
        let result = tool.execute(args.clone()).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed, args);
    }

    #[tokio::test]
    async fn echo_tool_metadata_is_correct() {
        let tool = EchoTool;
        assert_eq!(tool.name(), "echo");
        assert!(!tool.description().is_empty());
        let schema = tool.parameters_schema();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["message"].is_object());
    }

    #[test]
    fn registry_starts_empty() {
        let registry = ToolRegistry::new();
        assert!(registry.is_empty());
        assert!(registry.get("anything").is_none());
    }

    #[test]
    fn registry_register_and_get() {
        let mut registry = ToolRegistry::new();
        registry.register(EchoTool);
        assert!(!registry.is_empty());
        assert!(registry.get("echo").is_some());
        assert!(registry.get("nonexistent").is_none());
    }

    #[tokio::test]
    async fn registry_execute_known_tool() {
        let mut registry = ToolRegistry::new();
        registry.register(EchoTool);

        let call = ToolCall {
            id: "1".into(),
            name: "echo".into(),
            arguments: serde_json::json!({"message": "test"}),
        };
        let result = registry.execute(&call).await.unwrap();
        assert!(result.contains("test"));
    }

    #[tokio::test]
    async fn registry_execute_unknown_tool_returns_error() {
        let registry = ToolRegistry::new();
        let call = ToolCall {
            id: "1".into(),
            name: "nonexistent".into(),
            arguments: serde_json::json!({}),
        };
        let result = registry.execute(&call).await;
        assert!(result.is_err());
    }
}
