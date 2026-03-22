use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Event payload structs (emitted as notifications to clients)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MessageChunkPayload {
    pub agent_id: String,
    pub content: String,
    /// "message" or "thinking"
    pub kind: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ToolCallContentPayload {
    Text {
        text: String,
    },
    Diff {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        old_text: Option<String>,
        new_text: String,
    },
    Terminal {
        terminal_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolCallUpdatePayload {
    pub agent_id: String,
    pub tool_call_id: String,
    pub title: Option<String>,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub locations: Option<Vec<String>>,
    pub content: Option<Vec<ToolCallContentPayload>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PromptCompletePayload {
    pub agent_id: String,
    pub stop_reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentErrorPayload {
    pub agent_id: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StatusChangePayload {
    pub agent_id: String,
    pub status: String,
}

// ---------------------------------------------------------------------------
// AgentStatus
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum AgentStatus {
    Initializing,
    Idle,
    Working,
    Error,
}

impl std::fmt::Display for AgentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentStatus::Initializing => write!(f, "initializing"),
            AgentStatus::Idle => write!(f, "idle"),
            AgentStatus::Working => write!(f, "working"),
            AgentStatus::Error => write!(f, "error"),
        }
    }
}

// ---------------------------------------------------------------------------
// Agent detection types
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentInfo {
    pub name: String,
    pub binary: String,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KnownAgent {
    pub name: String,
    /// The full command string used to spawn the agent (e.g. "gemini --experimental-acp").
    pub command: String,
    pub available: bool,
}

// ---------------------------------------------------------------------------
// Agent summary (for list_agents response)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentSummary {
    pub id: String,
    pub cli: String,
    pub status: String,
    pub working_directory: String,
}

// ---------------------------------------------------------------------------
// JSON-RPC envelope types
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    pub params: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Notification enum (wraps all daemon-to-client events)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Notification {
    #[serde(rename = "agent:message-chunk")]
    MessageChunk(MessageChunkPayload),
    #[serde(rename = "agent:tool-call-update")]
    ToolCallUpdate(ToolCallUpdatePayload),
    #[serde(rename = "agent:prompt-complete")]
    PromptComplete(PromptCompletePayload),
    #[serde(rename = "agent:status-change")]
    StatusChange(StatusChangePayload),
    #[serde(rename = "agent:error")]
    Error(AgentErrorPayload),
}

impl Notification {
    pub fn event_name(&self) -> &'static str {
        match self {
            Notification::MessageChunk(_) => "agent:message-chunk",
            Notification::ToolCallUpdate(_) => "agent:tool-call-update",
            Notification::PromptComplete(_) => "agent:prompt-complete",
            Notification::StatusChange(_) => "agent:status-change",
            Notification::Error(_) => "agent:error",
        }
    }

    pub fn agent_id(&self) -> Option<&str> {
        match self {
            Notification::MessageChunk(p) => Some(&p.agent_id),
            Notification::ToolCallUpdate(p) => Some(&p.agent_id),
            Notification::PromptComplete(p) => Some(&p.agent_id),
            Notification::StatusChange(p) => Some(&p.agent_id),
            Notification::Error(p) => Some(&p.agent_id),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_serializes_with_event_name() {
        let n = Notification::MessageChunk(MessageChunkPayload {
            agent_id: "abc".into(),
            content: "hello".into(),
            kind: "message".into(),
        });
        let json = serde_json::to_string(&n).unwrap();
        assert!(json.contains("agent:message-chunk"));
    }

    #[test]
    fn jsonrpc_request_roundtrips() {
        let req = JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: 1,
            method: "spawn_agent".into(),
            params: Some(serde_json::json!({
                "working_directory": "/tmp",
                "agent_cli": "mock-agent"
            })),
        };
        let json = serde_json::to_string(&req).unwrap();
        let parsed: JsonRpcRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.method, "spawn_agent");
    }

    #[test]
    fn jsonrpc_response_with_error() {
        let resp = JsonRpcResponse {
            jsonrpc: "2.0".into(),
            id: 1,
            result: None,
            error: Some(JsonRpcError {
                code: -32600,
                message: "Invalid request".into(),
            }),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("Invalid request"));
        assert!(!json.contains("\"result\""));
    }

    #[test]
    fn notification_roundtrips_through_jsonrpc() {
        let original = Notification::MessageChunk(MessageChunkPayload {
            agent_id: "abc".into(),
            content: "hello".into(),
            kind: "message".into(),
        });
        let params = serde_json::to_value(&original).unwrap();
        let json_notif = JsonRpcNotification {
            jsonrpc: "2.0".into(),
            method: original.event_name().into(),
            params,
        };
        let wire = serde_json::to_string(&json_notif).unwrap();
        let parsed: JsonRpcNotification = serde_json::from_str(&wire).unwrap();
        let restored: Notification = serde_json::from_value(parsed.params).unwrap();
        match restored {
            Notification::MessageChunk(p) => {
                assert_eq!(p.agent_id, "abc");
                assert_eq!(p.content, "hello");
            }
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn agent_summary_serializes() {
        let s = AgentSummary {
            id: "abc".into(),
            cli: "mock-agent".into(),
            status: "idle".into(),
            working_directory: "/tmp".into(),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("working_directory"));
    }
}
