#![allow(dead_code)]

use crate::agent::conversation::{ChatMessage, Conversation, ToolCall};
use crate::agent::llm_client::{LlmClient, StreamEvent};
use crate::agent::tools::ToolRegistry;

pub struct AgentRunner {
    conversation: Conversation,
    llm_client: Box<dyn LlmClient>,
    tool_registry: ToolRegistry,
}

impl AgentRunner {
    pub fn new(llm_client: Box<dyn LlmClient>, tool_registry: ToolRegistry) -> Self {
        let mut conversation = Conversation::new();

        if let Some(prompt) = &llm_client.config().system_prompt {
            conversation.push(ChatMessage::system(prompt));
        }

        Self {
            conversation,
            llm_client,
            tool_registry,
        }
    }

    pub fn conversation(&self) -> &Conversation {
        &self.conversation
    }

    pub async fn send_message(&mut self, content: &str) -> eyre::Result<ChatMessage> {
        self.conversation.push(ChatMessage::user(content));
        self.run_loop().await
    }

    async fn run_loop(&mut self) -> eyre::Result<ChatMessage> {
        loop {
            let tools = if self.tool_registry.is_empty() {
                None
            } else {
                Some(&self.tool_registry)
            };

            let mut rx = self
                .llm_client
                .chat_stream(&self.conversation, tools)
                .await?;

            let mut partial_content = String::new();
            let mut tool_calls: Vec<ToolCall> = Vec::new();

            while let Some(event) = rx.recv().await {
                match event {
                    StreamEvent::Token(s) => {
                        partial_content.push_str(&s);
                    }
                    StreamEvent::ToolCallStart { .. } | StreamEvent::ToolCallArgDelta { .. } => {
                        // Ignored — retained in StreamEvent for future UI streaming
                    }
                    StreamEvent::ToolCallComplete(call) => {
                        tool_calls.push(call);
                    }
                    StreamEvent::Done { .. } => {
                        if tool_calls.is_empty() {
                            let msg = ChatMessage::assistant(&partial_content);
                            self.conversation.push(msg.clone());
                            return Ok(msg);
                        }

                        let msg = if partial_content.is_empty() {
                            ChatMessage::assistant_tool_calls(tool_calls.clone())
                        } else {
                            ChatMessage::assistant_with_tool_calls(
                                &partial_content,
                                tool_calls.clone(),
                            )
                        };
                        self.conversation.push(msg);

                        for call in &tool_calls {
                            let result = self.tool_registry.execute(call).await?;
                            self.conversation
                                .push(ChatMessage::tool_result(&call.id, &result));
                        }

                        tool_calls.clear();
                        break; // Re-enter the outer loop
                    }
                    StreamEvent::Error(e) => {
                        return Err(eyre::eyre!("LLM stream error: {}", e));
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::conversation::ToolCall;
    use crate::agent::llm_client::{LlmClientConfig, StreamEvent};
    use crate::agent::tools::{EchoTool, ToolRegistry};
    use std::sync::Arc;
    use tokio::sync::{mpsc, Mutex};

    fn test_config(system_prompt: Option<&str>) -> LlmClientConfig {
        LlmClientConfig {
            base_url: "http://test".into(),
            api_key: "test-key".into(),
            model: "test-model".into(),
            max_tokens: 100,
            temperature: 0.0,
            system_prompt: system_prompt.map(String::from),
        }
    }

    struct MockLlmClient {
        config: LlmClientConfig,
        responses: Arc<Mutex<Vec<Vec<StreamEvent>>>>,
    }

    impl MockLlmClient {
        fn new(config: LlmClientConfig, responses: Vec<Vec<StreamEvent>>) -> Self {
            Self {
                config,
                responses: Arc::new(Mutex::new(responses)),
            }
        }
    }

    #[async_trait::async_trait]
    impl LlmClient for MockLlmClient {
        fn config(&self) -> &LlmClientConfig {
            &self.config
        }

        async fn chat_stream(
            &self,
            _conversation: &Conversation,
            _tools: Option<&ToolRegistry>,
        ) -> eyre::Result<mpsc::Receiver<StreamEvent>> {
            let (tx, rx) = mpsc::channel(100);
            let mut responses = self.responses.lock().await;
            let events = if responses.is_empty() {
                vec![StreamEvent::Error("No more mock responses".into())]
            } else {
                responses.remove(0)
            };

            tokio::spawn(async move {
                for event in events {
                    let _ = tx.send(event).await;
                }
            });

            Ok(rx)
        }
    }

    #[tokio::test]
    async fn runner_injects_system_prompt_on_construction() {
        let config = test_config(Some("be helpful"));
        let mock = MockLlmClient::new(config, vec![]);
        let registry = ToolRegistry::new();
        let runner = AgentRunner::new(Box::new(mock), registry);

        assert_eq!(runner.conversation().len(), 1);
        assert_eq!(
            runner.conversation().messages()[0].content(),
            Some("be helpful")
        );
    }

    #[tokio::test]
    async fn runner_no_system_prompt_starts_empty() {
        let config = test_config(None);
        let mock = MockLlmClient::new(config, vec![]);
        let registry = ToolRegistry::new();
        let runner = AgentRunner::new(Box::new(mock), registry);

        assert!(runner.conversation().is_empty());
    }

    #[tokio::test]
    async fn runner_simple_response() {
        let config = test_config(None);
        let events = vec![
            StreamEvent::Token("Hello ".into()),
            StreamEvent::Token("world!".into()),
            StreamEvent::Done {
                stop_reason: Some("stop".into()),
            },
        ];
        let mock = MockLlmClient::new(config, vec![events]);
        let registry = ToolRegistry::new();
        let mut runner = AgentRunner::new(Box::new(mock), registry);

        let result = runner.send_message("hi").await.unwrap();
        assert_eq!(result.content(), Some("Hello world!"));
        assert_eq!(runner.conversation().len(), 2); // user + assistant
    }

    #[tokio::test]
    async fn runner_empty_response() {
        let config = test_config(None);
        let events = vec![StreamEvent::Done {
            stop_reason: Some("stop".into()),
        }];
        let mock = MockLlmClient::new(config, vec![events]);
        let registry = ToolRegistry::new();
        let mut runner = AgentRunner::new(Box::new(mock), registry);

        let result = runner.send_message("hi").await.unwrap();
        assert_eq!(result.content(), Some(""));
    }

    #[tokio::test]
    async fn runner_tool_call_loop() {
        let config = test_config(None);

        let first_response = vec![
            StreamEvent::ToolCallComplete(ToolCall {
                id: "call_1".into(),
                name: "echo".into(),
                arguments: serde_json::json!({"message": "test"}),
            }),
            StreamEvent::Done {
                stop_reason: Some("tool_calls".into()),
            },
        ];

        let second_response = vec![
            StreamEvent::Token("The echo returned: test".into()),
            StreamEvent::Done {
                stop_reason: Some("stop".into()),
            },
        ];

        let mock = MockLlmClient::new(config, vec![first_response, second_response]);
        let mut registry = ToolRegistry::new();
        registry.register(EchoTool);
        let mut runner = AgentRunner::new(Box::new(mock), registry);

        let result = runner.send_message("echo test").await.unwrap();
        assert_eq!(result.content(), Some("The echo returned: test"));

        // Conversation should have: user, assistant_tool_calls, tool_result, assistant
        assert_eq!(runner.conversation().len(), 4);
    }

    #[tokio::test]
    async fn runner_handles_stream_error() {
        let config = test_config(None);
        let events = vec![StreamEvent::Error("connection failed".into())];
        let mock = MockLlmClient::new(config, vec![events]);
        let registry = ToolRegistry::new();
        let mut runner = AgentRunner::new(Box::new(mock), registry);

        let result = runner.send_message("hi").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn runner_ignores_tool_call_start_and_arg_delta() {
        let config = test_config(None);
        let events = vec![
            StreamEvent::Token("response".into()),
            StreamEvent::ToolCallStart {
                index: 0,
                id: "x".into(),
                name: "y".into(),
            },
            StreamEvent::ToolCallArgDelta {
                index: 0,
                arguments: "{}".into(),
            },
            StreamEvent::Done {
                stop_reason: Some("stop".into()),
            },
        ];
        let mock = MockLlmClient::new(config, vec![events]);
        let registry = ToolRegistry::new();
        let mut runner = AgentRunner::new(Box::new(mock), registry);

        let result = runner.send_message("hi").await.unwrap();
        assert_eq!(result.content(), Some("response"));
    }

    #[tokio::test]
    async fn runner_finalizes_content_before_tool_calls() {
        let config = test_config(None);

        let first_response = vec![
            StreamEvent::Token("Let me check...".into()),
            StreamEvent::ToolCallComplete(ToolCall {
                id: "call_1".into(),
                name: "echo".into(),
                arguments: serde_json::json!({"message": "hi"}),
            }),
            StreamEvent::Done {
                stop_reason: Some("tool_calls".into()),
            },
        ];

        let second_response = vec![
            StreamEvent::Token("Done".into()),
            StreamEvent::Done {
                stop_reason: Some("stop".into()),
            },
        ];

        let mock = MockLlmClient::new(config, vec![first_response, second_response]);
        let mut registry = ToolRegistry::new();
        registry.register(EchoTool);
        let mut runner = AgentRunner::new(Box::new(mock), registry);

        let result = runner.send_message("do it").await.unwrap();
        assert_eq!(result.content(), Some("Done"));

        // user, assistant_with_tool_calls("Let me check..."), tool_result, assistant("Done")
        assert_eq!(runner.conversation().len(), 4);
        assert_eq!(
            runner.conversation().messages()[1].content(),
            Some("Let me check...")
        );
        assert!(runner.conversation().messages()[1].tool_calls().is_some());
    }
}
