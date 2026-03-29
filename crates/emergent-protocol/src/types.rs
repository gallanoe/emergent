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
pub struct UserMessagePayload {
    pub agent_id: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SystemMessagePayload {
    pub agent_id: String,
    pub content: String,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NudgeDeliveredPayload {
    pub agent_id: String,
    pub count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SwarmMessagePayload {
    pub from_agent_id: String,
    pub from_agent_name: String,
    pub to_agent_id: String,
    pub to_agent_name: String,
    pub body: String,
    pub timestamp: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TopologyChangedPayload {
    pub agent_id_a: String,
    pub agent_id_b: String,
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
    Dead,
}

impl std::fmt::Display for AgentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentStatus::Initializing => write!(f, "initializing"),
            AgentStatus::Idle => write!(f, "idle"),
            AgentStatus::Working => write!(f, "working"),
            AgentStatus::Error => write!(f, "error"),
            AgentStatus::Dead => write!(f, "dead"),
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

// ---------------------------------------------------------------------------
// Config option types (ACP session config → daemon-to-client)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConfigSelectOption {
    pub value: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConfigSelectGroup {
    pub label: String,
    pub options: Vec<ConfigSelectOption>,
}

// Untagged deserialization works because ConfigSelectGroup has `label` + `options`
// while ConfigSelectOption has `value` + `name` — structurally distinct.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ConfigSelectOptions {
    Ungrouped(Vec<ConfigSelectOption>),
    Grouped(Vec<ConfigSelectGroup>),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConfigOption {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub current_value: String,
    pub options: ConfigSelectOptions,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConfigChangeEntry {
    pub option_name: String,
    pub new_value_name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConfigUpdatePayload {
    pub agent_id: String,
    pub config_options: Vec<ConfigOption>,
    pub changes: Vec<ConfigChangeEntry>,
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
    #[serde(rename = "agent:config-update")]
    ConfigUpdate(ConfigUpdatePayload),
    #[serde(rename = "agent:user-message")]
    UserMessage(UserMessagePayload),
    #[serde(rename = "agent:error")]
    Error(AgentErrorPayload),
    #[serde(rename = "agent:nudge-delivered")]
    NudgeDelivered(NudgeDeliveredPayload),
    #[serde(rename = "agent:system-message")]
    SystemMessage(SystemMessagePayload),
    #[serde(rename = "swarm:message")]
    SwarmMessage(SwarmMessagePayload),
    #[serde(rename = "swarm:topology-changed")]
    TopologyChanged(TopologyChangedPayload),
}

impl Notification {
    pub fn event_name(&self) -> &'static str {
        match self {
            Notification::MessageChunk(_) => "agent:message-chunk",
            Notification::ToolCallUpdate(_) => "agent:tool-call-update",
            Notification::PromptComplete(_) => "agent:prompt-complete",
            Notification::StatusChange(_) => "agent:status-change",
            Notification::ConfigUpdate(_) => "agent:config-update",
            Notification::UserMessage(_) => "agent:user-message",
            Notification::Error(_) => "agent:error",
            Notification::NudgeDelivered(_) => "agent:nudge-delivered",
            Notification::SystemMessage(_) => "agent:system-message",
            Notification::SwarmMessage(_) => "swarm:message",
            Notification::TopologyChanged(_) => "swarm:topology-changed",
        }
    }

    pub fn agent_id(&self) -> Option<&str> {
        match self {
            Notification::MessageChunk(p) => Some(&p.agent_id),
            Notification::ToolCallUpdate(p) => Some(&p.agent_id),
            Notification::PromptComplete(p) => Some(&p.agent_id),
            Notification::StatusChange(p) => Some(&p.agent_id),
            Notification::ConfigUpdate(p) => Some(&p.agent_id),
            Notification::UserMessage(p) => Some(&p.agent_id),
            Notification::Error(p) => Some(&p.agent_id),
            Notification::NudgeDelivered(p) => Some(&p.agent_id),
            Notification::SystemMessage(p) => Some(&p.agent_id),
            Notification::SwarmMessage(_) => None, // not agent-specific
            Notification::TopologyChanged(_) => None, // not agent-specific
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
    fn config_update_notification_roundtrips() {
        let n = Notification::ConfigUpdate(ConfigUpdatePayload {
            agent_id: "abc".into(),
            config_options: vec![ConfigOption {
                id: "model".into(),
                name: "Model".into(),
                description: None,
                category: Some("model".into()),
                current_value: "opus-4".into(),
                options: ConfigSelectOptions::Ungrouped(vec![
                    ConfigSelectOption {
                        value: "opus-4".into(),
                        name: "Opus 4".into(),
                    },
                    ConfigSelectOption {
                        value: "sonnet-4".into(),
                        name: "Sonnet 4".into(),
                    },
                ]),
            }],
            changes: vec![],
        });
        let json = serde_json::to_string(&n).unwrap();
        assert!(json.contains("agent:config-update"));
        let restored: Notification = serde_json::from_str(&json).unwrap();
        match restored {
            Notification::ConfigUpdate(p) => {
                assert_eq!(p.config_options.len(), 1);
                assert_eq!(p.config_options[0].id, "model");
            }
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn system_message_notification_roundtrips() {
        let n = Notification::SystemMessage(SystemMessagePayload {
            agent_id: "abc".into(),
            content: "Management permissions have been granted.".into(),
        });
        let json = serde_json::to_string(&n).unwrap();
        assert!(json.contains("agent:system-message"));
        let restored: Notification = serde_json::from_str(&json).unwrap();
        match restored {
            Notification::SystemMessage(p) => {
                assert_eq!(p.agent_id, "abc");
                assert!(p.content.contains("Management permissions"));
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
            role: None,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("working_directory"));
    }
}
