#![allow(dead_code)]

use async_openai::{
    config::OpenAIConfig,
    types::chat::{
        ChatCompletionMessageToolCall, ChatCompletionMessageToolCallChunk,
        ChatCompletionMessageToolCalls, ChatCompletionRequestAssistantMessage,
        ChatCompletionRequestAssistantMessageContent, ChatCompletionRequestMessage,
        ChatCompletionRequestSystemMessage, ChatCompletionRequestSystemMessageContent,
        ChatCompletionRequestToolMessage, ChatCompletionRequestToolMessageContent,
        ChatCompletionRequestUserMessage, ChatCompletionRequestUserMessageContent,
        ChatCompletionTool, ChatCompletionTools, CreateChatCompletionRequestArgs, FinishReason,
        FunctionCall, FunctionObject,
    },
    Client,
};
use async_trait::async_trait;
use futures::StreamExt;
use std::collections::BTreeMap;
use tokio::sync::mpsc;

use crate::agent::conversation::{Conversation, Role, ToolCall};
use crate::agent::llm_client::{LlmClient, LlmClientConfig, StreamEvent};
use crate::agent::tools::ToolRegistry;

fn conversation_to_openai_messages(
    conversation: &Conversation,
) -> Vec<ChatCompletionRequestMessage> {
    conversation
        .messages()
        .iter()
        .map(|msg| match msg.role() {
            Role::System => {
                ChatCompletionRequestMessage::System(ChatCompletionRequestSystemMessage {
                    content: ChatCompletionRequestSystemMessageContent::Text(
                        msg.content().unwrap_or_default().to_string(),
                    ),
                    name: None,
                })
            }
            Role::User => ChatCompletionRequestMessage::User(ChatCompletionRequestUserMessage {
                content: ChatCompletionRequestUserMessageContent::Text(
                    msg.content().unwrap_or_default().to_string(),
                ),
                name: None,
            }),
            Role::Assistant => {
                let tool_calls = msg.tool_calls().map(|calls| {
                    calls
                        .iter()
                        .map(|call| {
                            ChatCompletionMessageToolCalls::Function(
                                ChatCompletionMessageToolCall {
                                    id: call.id.clone(),
                                    function: FunctionCall {
                                        name: call.name.clone(),
                                        arguments: call.arguments.to_string(),
                                    },
                                },
                            )
                        })
                        .collect()
                });
                #[allow(deprecated)]
                ChatCompletionRequestMessage::Assistant(ChatCompletionRequestAssistantMessage {
                    content: msg
                        .content()
                        .map(|c| ChatCompletionRequestAssistantMessageContent::Text(c.to_string())),
                    tool_calls,
                    name: None,
                    refusal: None,
                    audio: None,
                    function_call: None,
                })
            }
            Role::Tool => {
                let result = msg
                    .get_tool_result()
                    .expect("Tool message must have result");
                ChatCompletionRequestMessage::Tool(ChatCompletionRequestToolMessage {
                    content: ChatCompletionRequestToolMessageContent::Text(result.content.clone()),
                    tool_call_id: result.tool_call_id.clone(),
                })
            }
        })
        .collect()
}

fn registry_to_openai_tools(registry: &ToolRegistry) -> Vec<ChatCompletionTools> {
    registry
        .tool_definitions()
        .into_iter()
        .map(|(name, description, parameters)| {
            ChatCompletionTools::Function(ChatCompletionTool {
                function: FunctionObject {
                    name: name.to_string(),
                    description: Some(description.to_string()),
                    parameters: Some(parameters),
                    strict: None,
                },
            })
        })
        .collect()
}

struct PartialToolCall {
    id: String,
    name: String,
    arguments: String,
}

struct ToolCallAccumulator {
    calls: BTreeMap<u32, PartialToolCall>,
}

impl ToolCallAccumulator {
    fn new() -> Self {
        Self {
            calls: BTreeMap::new(),
        }
    }

    fn process_delta(&mut self, chunk: &ChatCompletionMessageToolCallChunk) -> Option<StreamEvent> {
        if let Some(id) = &chunk.id {
            let name = chunk
                .function
                .as_ref()
                .and_then(|f| f.name.as_ref())
                .cloned()
                .unwrap_or_default();

            self.calls.insert(
                chunk.index,
                PartialToolCall {
                    id: id.clone(),
                    name: name.clone(),
                    arguments: String::new(),
                },
            );

            return Some(StreamEvent::ToolCallStart {
                index: chunk.index,
                id: id.clone(),
                name,
            });
        }

        if let Some(func) = &chunk.function {
            if let Some(args) = &func.arguments {
                if let Some(partial) = self.calls.get_mut(&chunk.index) {
                    partial.arguments.push_str(args);
                    return Some(StreamEvent::ToolCallArgDelta {
                        index: chunk.index,
                        arguments: args.clone(),
                    });
                }
            }
        }

        None
    }

    fn finalize(self) -> Vec<ToolCall> {
        self.calls
            .into_values()
            .map(|p| {
                let arguments = serde_json::from_str(&p.arguments)
                    .unwrap_or(serde_json::Value::String(p.arguments));
                ToolCall {
                    id: p.id,
                    name: p.name,
                    arguments,
                }
            })
            .collect()
    }
}

pub struct OpenRouterClient {
    config: LlmClientConfig,
    client: Client<OpenAIConfig>,
}

impl OpenRouterClient {
    pub fn new(config: LlmClientConfig) -> eyre::Result<Self> {
        let openai_config = OpenAIConfig::new()
            .with_api_key(&config.api_key)
            .with_api_base(&config.base_url);
        let client = Client::with_config(openai_config);
        Ok(Self { config, client })
    }
}

#[async_trait]
impl LlmClient for OpenRouterClient {
    fn config(&self) -> &LlmClientConfig {
        &self.config
    }

    async fn chat_stream(
        &self,
        conversation: &Conversation,
        tools: Option<&ToolRegistry>,
    ) -> eyre::Result<mpsc::Receiver<StreamEvent>> {
        let (tx, rx) = mpsc::channel::<StreamEvent>(100);
        let messages = conversation_to_openai_messages(conversation);

        let mut args = CreateChatCompletionRequestArgs::default();
        args.model(&self.config.model)
            .messages(messages)
            .max_completion_tokens(self.config.max_tokens)
            .temperature(self.config.temperature);

        if let Some(registry) = tools {
            if !registry.is_empty() {
                let tool_defs = registry_to_openai_tools(registry);
                if !tool_defs.is_empty() {
                    args.tools(tool_defs);
                }
            }
        }

        let request = args.build()?;
        let mut stream = self.client.chat().create_stream(request).await?;

        tokio::spawn(async move {
            let mut accumulator = ToolCallAccumulator::new();
            while let Some(result) = stream.next().await {
                match result {
                    Ok(response) => {
                        if let Some(choice) = response.choices.first() {
                            if let Some(content) = &choice.delta.content {
                                if !content.is_empty() {
                                    let _ = tx.send(StreamEvent::Token(content.clone())).await;
                                }
                            }
                            if let Some(tool_calls) = &choice.delta.tool_calls {
                                for chunk in tool_calls {
                                    if let Some(event) = accumulator.process_delta(chunk) {
                                        let _ = tx.send(event).await;
                                    }
                                }
                            }
                            if let Some(reason) = &choice.finish_reason {
                                match reason {
                                    FinishReason::ToolCalls => {
                                        let calls = accumulator.finalize();
                                        for call in calls {
                                            let _ =
                                                tx.send(StreamEvent::ToolCallComplete(call)).await;
                                        }
                                        let _ = tx
                                            .send(StreamEvent::Done {
                                                stop_reason: Some("tool_calls".to_string()),
                                            })
                                            .await;
                                        return;
                                    }
                                    FinishReason::Stop => {
                                        let _ = tx
                                            .send(StreamEvent::Done {
                                                stop_reason: Some("stop".to_string()),
                                            })
                                            .await;
                                        return;
                                    }
                                    other => {
                                        let _ = tx
                                            .send(StreamEvent::Done {
                                                stop_reason: Some(format!("{:?}", other)),
                                            })
                                            .await;
                                        return;
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(StreamEvent::Error(e.to_string())).await;
                        return;
                    }
                }
            }
            let _ = tx.send(StreamEvent::Done { stop_reason: None }).await;
        });

        Ok(rx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::conversation::{ChatMessage, ToolCall as ConvToolCall};
    use crate::agent::llm_client::StreamEvent;
    use async_openai::types::chat::FunctionCallStream;

    #[test]
    fn converts_system_message_to_openai() {
        let mut conv = Conversation::new();
        conv.push(ChatMessage::system("be helpful"));
        let msgs = conversation_to_openai_messages(&conv);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(msgs[0], ChatCompletionRequestMessage::System(_)));
    }

    #[test]
    fn converts_user_message_to_openai() {
        let mut conv = Conversation::new();
        conv.push(ChatMessage::user("hello"));
        let msgs = conversation_to_openai_messages(&conv);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(msgs[0], ChatCompletionRequestMessage::User(_)));
    }

    #[test]
    fn converts_assistant_message_to_openai() {
        let mut conv = Conversation::new();
        conv.push(ChatMessage::assistant("response"));
        let msgs = conversation_to_openai_messages(&conv);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(
            msgs[0],
            ChatCompletionRequestMessage::Assistant(_)
        ));
    }

    #[test]
    fn converts_tool_result_to_openai() {
        let mut conv = Conversation::new();
        conv.push(ChatMessage::tool_result("call_1", "result"));
        let msgs = conversation_to_openai_messages(&conv);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(msgs[0], ChatCompletionRequestMessage::Tool(_)));
    }

    #[test]
    fn converts_full_conversation_to_openai() {
        let mut conv = Conversation::new();
        conv.push(ChatMessage::system("sys"));
        conv.push(ChatMessage::user("usr"));
        conv.push(ChatMessage::assistant("asst"));
        conv.push(ChatMessage::tool_result("tc1", "result"));
        let msgs = conversation_to_openai_messages(&conv);
        assert_eq!(msgs.len(), 4);
    }

    #[test]
    fn converts_assistant_with_tool_calls_to_openai() {
        let calls = vec![ConvToolCall {
            id: "call_1".into(),
            name: "echo".into(),
            arguments: serde_json::json!({"msg": "hi"}),
        }];
        let mut conv = Conversation::new();
        conv.push(ChatMessage::assistant_tool_calls(calls));
        let msgs = conversation_to_openai_messages(&conv);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(
            msgs[0],
            ChatCompletionRequestMessage::Assistant(_)
        ));
    }

    #[test]
    fn accumulator_processes_tool_call_start() {
        let mut acc = ToolCallAccumulator::new();
        let chunk = ChatCompletionMessageToolCallChunk {
            index: 0,
            id: Some("call_123".to_string()),
            r#type: None,
            function: Some(FunctionCallStream {
                name: Some("echo".to_string()),
                arguments: None,
            }),
        };
        let event = acc.process_delta(&chunk);
        assert!(matches!(event, Some(StreamEvent::ToolCallStart { .. })));
    }

    #[test]
    fn accumulator_processes_argument_delta() {
        let mut acc = ToolCallAccumulator::new();
        acc.process_delta(&ChatCompletionMessageToolCallChunk {
            index: 0,
            id: Some("call_123".to_string()),
            r#type: None,
            function: Some(FunctionCallStream {
                name: Some("echo".to_string()),
                arguments: None,
            }),
        });
        let chunk = ChatCompletionMessageToolCallChunk {
            index: 0,
            id: None,
            r#type: None,
            function: Some(FunctionCallStream {
                name: None,
                arguments: Some(r#"{"message": "#.to_string()),
            }),
        };
        let event = acc.process_delta(&chunk);
        assert!(matches!(event, Some(StreamEvent::ToolCallArgDelta { .. })));
    }

    #[test]
    fn accumulator_finalize_assembles_complete_tool_call() {
        let mut acc = ToolCallAccumulator::new();
        acc.process_delta(&ChatCompletionMessageToolCallChunk {
            index: 0,
            id: Some("call_123".to_string()),
            r#type: None,
            function: Some(FunctionCallStream {
                name: Some("echo".to_string()),
                arguments: None,
            }),
        });
        acc.process_delta(&ChatCompletionMessageToolCallChunk {
            index: 0,
            id: None,
            r#type: None,
            function: Some(FunctionCallStream {
                name: None,
                arguments: Some(r#"{"message": "#.to_string()),
            }),
        });
        acc.process_delta(&ChatCompletionMessageToolCallChunk {
            index: 0,
            id: None,
            r#type: None,
            function: Some(FunctionCallStream {
                name: None,
                arguments: Some(r#""hello"}"#.to_string()),
            }),
        });
        let calls = acc.finalize();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "call_123");
        assert_eq!(calls[0].name, "echo");
        assert_eq!(calls[0].arguments, serde_json::json!({"message": "hello"}));
    }

    #[test]
    fn accumulator_handles_multiple_tool_calls() {
        let mut acc = ToolCallAccumulator::new();
        // First tool call
        acc.process_delta(&ChatCompletionMessageToolCallChunk {
            index: 0,
            id: Some("call_1".to_string()),
            r#type: None,
            function: Some(FunctionCallStream {
                name: Some("echo".to_string()),
                arguments: None,
            }),
        });
        acc.process_delta(&ChatCompletionMessageToolCallChunk {
            index: 0,
            id: None,
            r#type: None,
            function: Some(FunctionCallStream {
                name: None,
                arguments: Some(r#"{"message": "one"}"#.to_string()),
            }),
        });
        // Second tool call
        acc.process_delta(&ChatCompletionMessageToolCallChunk {
            index: 1,
            id: Some("call_2".to_string()),
            r#type: None,
            function: Some(FunctionCallStream {
                name: Some("echo".to_string()),
                arguments: None,
            }),
        });
        acc.process_delta(&ChatCompletionMessageToolCallChunk {
            index: 1,
            id: None,
            r#type: None,
            function: Some(FunctionCallStream {
                name: None,
                arguments: Some(r#"{"message": "two"}"#.to_string()),
            }),
        });
        let calls = acc.finalize();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].id, "call_1");
        assert_eq!(calls[1].id, "call_2");
    }
}
