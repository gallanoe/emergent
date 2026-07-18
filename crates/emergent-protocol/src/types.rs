use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Event payload structs (emitted as notifications to clients)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MessageChunkPayload {
    pub thread_id: String,
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
pub struct ToolCallEventPayload {
    pub thread_id: String,
    pub tool_call_id: String,
    pub title: Option<String>,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub locations: Option<Vec<String>>,
    pub content: Option<Vec<ToolCallContentPayload>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PromptCompletePayload {
    pub thread_id: String,
    pub stop_reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UserMessagePayload {
    pub thread_id: String,
    pub content: String,
    /// True only for the first `UserMessageChunk` of a manager-initiated turn.
    /// Agents that emit zero echoes, sub-agent synthetic messages, or subsequent
    /// chunks of the same turn all carry `false`.
    pub is_echo: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SystemMessagePayload {
    pub thread_id: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ThreadErrorPayload {
    pub thread_id: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StatusChangePayload {
    pub thread_id: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionReadyPayload {
    pub thread_id: String,
    pub acp_session_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NudgeDeliveredPayload {
    pub thread_id: String,
    pub count: usize,
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
// Workspace types
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Hash, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceId(pub String);

impl std::fmt::Display for WorkspaceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<String> for WorkspaceId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for WorkspaceId {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkspaceEntry {
    pub id: WorkspaceId,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkspaceSummary {
    pub id: WorkspaceId,
    pub name: String,
    pub agent_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    pub id: WorkspaceId,
    pub name: String,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TerminalOutputPayload {
    pub session_id: String,
    #[serde(with = "base64_bytes")]
    pub data: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TerminalExitedPayload {
    pub session_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskStatusNotificationPayload {
    pub task_id: String,
    pub creator_thread_id: String,
    pub kind: String,
    pub message: String,
}

/// A single queued message, flattened for the frontend. `source` is one of
/// "user" | "task" | "thread"; `from` carries the sending agent's display name
/// when `source == "thread"`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QueuedMessageView {
    pub id: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// Present when `source == "task"` — the task id for the Rail label.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    /// Present when `source == "task"` — the notification kind
    /// (`started` | `update` | `completed`) driving the Rail status glyph.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_status: Option<String>,
    pub content: String,
    pub created_at: String,
}

/// Emitted whenever a thread's backend message queue changes for a reason the
/// frontend did not directly initiate (an inbound inter-thread/task message
/// landed, or the prompt loop drained the queue at turn start). Self-initiated
/// edits are answered by the command's return value, not this event.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QueueChangedPayload {
    pub thread_id: String,
    pub items: Vec<QueuedMessageView>,
}

/// Emitted by the prompt loop once a drained turn is **accepted by the command
/// loop** (channel-accepted), carrying the split for the transcript: `user_text`
/// is the bare-coalesced user messages (None if the batch had none), and
/// `notifications` are the task/thread items that were dispatched this turn.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TurnDispatchedPayload {
    pub thread_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_text: Option<String>,
    pub notifications: Vec<QueuedMessageView>,
}

mod base64_bytes {
    use base64::Engine;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(data: &[u8], s: S) -> Result<S::Ok, S::Error> {
        base64::engine::general_purpose::STANDARD
            .encode(data)
            .serialize(s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        base64::engine::general_purpose::STANDARD
            .decode(&s)
            .map_err(serde::de::Error::custom)
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
    /// Stable id for UI assets (e.g. logos), not inferred from the command string.
    pub provider: String,
}

// ---------------------------------------------------------------------------
// Agent definition (template for creating threads)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentDefinition {
    pub id: String,
    pub workspace_id: WorkspaceId,
    pub name: String,
    pub cli: String,
    /// Chosen at creation from `KnownAgent::provider`; used for branding only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
}

// ---------------------------------------------------------------------------
// Thread summary (for list_threads response)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ThreadSummary {
    pub id: String,
    pub agent_id: String,
    pub status: String,
    pub workspace_id: WorkspaceId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acp_session_id: Option<String>,
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
    pub thread_id: String,
    pub config_options: Vec<ConfigOption>,
    pub changes: Vec<ConfigChangeEntry>,
}

// ---------------------------------------------------------------------------
// Turn-usage payload (per-PromptResponse token accounting)
// ---------------------------------------------------------------------------

pub fn is_zero_u64(v: &u64) -> bool {
    *v == 0
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TurnUsagePayload {
    pub thread_id: String,
    pub workspace_id: String,
    pub agent_definition_id: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default, skip_serializing_if = "is_zero_u64")]
    pub cached_read_tokens: u64,
    #[serde(default, skip_serializing_if = "is_zero_u64")]
    pub cached_write_tokens: u64,
    #[serde(default, skip_serializing_if = "is_zero_u64")]
    pub thought_tokens: u64,
    pub total_tokens: u64,
    pub at: String,
}

// ---------------------------------------------------------------------------
// Token-usage payload
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ThreadTokenUsagePayload {
    pub thread_id: String,
    pub used_tokens: u64,
    pub context_size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_amount: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_currency: Option<String>,
}

// ---------------------------------------------------------------------------
// Agent definition notification payloads
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentCreatedPayload {
    pub definition_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentDeletedPayload {
    pub definition_id: String,
}

// ---------------------------------------------------------------------------
// Notification enum (wraps all daemon-to-client events)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Notification {
    #[serde(rename = "thread:message-chunk")]
    MessageChunk(MessageChunkPayload),
    #[serde(rename = "thread:tool-call-update")]
    ToolCallUpdate(ToolCallEventPayload),
    #[serde(rename = "thread:prompt-complete")]
    PromptComplete(PromptCompletePayload),
    #[serde(rename = "thread:status-change")]
    StatusChange(StatusChangePayload),
    #[serde(rename = "thread:config-update")]
    ConfigUpdate(ConfigUpdatePayload),
    #[serde(rename = "thread:user-message")]
    UserMessage(UserMessagePayload),
    #[serde(rename = "thread:error")]
    Error(ThreadErrorPayload),
    #[serde(rename = "thread:nudge-delivered")]
    NudgeDelivered(NudgeDeliveredPayload),
    #[serde(rename = "thread:system-message")]
    SystemMessage(SystemMessagePayload),
    #[serde(rename = "terminal:output")]
    TerminalOutput(TerminalOutputPayload),
    #[serde(rename = "terminal:exited")]
    TerminalExited(TerminalExitedPayload),
    #[serde(rename = "agent:definition-created")]
    AgentCreated(AgentCreatedPayload),
    #[serde(rename = "agent:definition-deleted")]
    AgentDeleted(AgentDeletedPayload),
    #[serde(rename = "task:created")]
    TaskCreated(crate::TaskPayload),
    #[serde(rename = "task:updated")]
    TaskUpdated(crate::TaskPayload),
    #[serde(rename = "task:status-notification")]
    TaskStatusNotification(TaskStatusNotificationPayload),
    #[serde(rename = "thread:session-ready")]
    SessionReady(SessionReadyPayload),
    #[serde(rename = "thread:token-usage")]
    TokenUsage(ThreadTokenUsagePayload),
    #[serde(rename = "thread:turn-usage")]
    TurnUsage(TurnUsagePayload),
    #[serde(rename = "thread:queue-changed")]
    QueueChanged(QueueChangedPayload),
    #[serde(rename = "thread:turn-dispatched")]
    TurnDispatched(TurnDispatchedPayload),
}

impl Notification {
    pub fn event_name(&self) -> &'static str {
        match self {
            Notification::MessageChunk(_) => "thread:message-chunk",
            Notification::ToolCallUpdate(_) => "thread:tool-call-update",
            Notification::PromptComplete(_) => "thread:prompt-complete",
            Notification::StatusChange(_) => "thread:status-change",
            Notification::ConfigUpdate(_) => "thread:config-update",
            Notification::UserMessage(_) => "thread:user-message",
            Notification::Error(_) => "thread:error",
            Notification::NudgeDelivered(_) => "thread:nudge-delivered",
            Notification::SystemMessage(_) => "thread:system-message",
            Notification::TerminalOutput(_) => "terminal:output",
            Notification::TerminalExited(_) => "terminal:exited",
            Notification::AgentCreated(_) => "agent:definition-created",
            Notification::AgentDeleted(_) => "agent:definition-deleted",
            Notification::TaskCreated(_) => "task:created",
            Notification::TaskUpdated(_) => "task:updated",
            Notification::TaskStatusNotification(_) => "task:status-notification",
            Notification::SessionReady(_) => "thread:session-ready",
            Notification::TokenUsage(_) => "thread:token-usage",
            Notification::TurnUsage(_) => "thread:turn-usage",
            Notification::QueueChanged(_) => "thread:queue-changed",
            Notification::TurnDispatched(_) => "thread:turn-dispatched",
        }
    }

    pub fn thread_id(&self) -> Option<&str> {
        match self {
            Notification::MessageChunk(p) => Some(&p.thread_id),
            Notification::ToolCallUpdate(p) => Some(&p.thread_id),
            Notification::PromptComplete(p) => Some(&p.thread_id),
            Notification::StatusChange(p) => Some(&p.thread_id),
            Notification::ConfigUpdate(p) => Some(&p.thread_id),
            Notification::UserMessage(p) => Some(&p.thread_id),
            Notification::Error(p) => Some(&p.thread_id),
            Notification::NudgeDelivered(p) => Some(&p.thread_id),
            Notification::SystemMessage(p) => Some(&p.thread_id),
            Notification::TerminalOutput(_) => None,
            Notification::TerminalExited(_) => None,
            Notification::AgentCreated(_) => None,
            Notification::AgentDeleted(_) => None,
            Notification::TaskCreated(_) => None,
            Notification::TaskUpdated(_) => None,
            Notification::TaskStatusNotification(p) => Some(&p.creator_thread_id),
            Notification::SessionReady(p) => Some(&p.thread_id),
            Notification::TokenUsage(p) => Some(&p.thread_id),
            Notification::TurnUsage(p) => Some(&p.thread_id),
            Notification::QueueChanged(p) => Some(&p.thread_id),
            Notification::TurnDispatched(p) => Some(&p.thread_id),
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
            thread_id: "abc".into(),
            content: "hello".into(),
            kind: "message".into(),
        });
        let json = serde_json::to_string(&n).unwrap();
        assert!(json.contains("thread:message-chunk"));
    }

    #[test]
    fn config_update_notification_roundtrips() {
        let n = Notification::ConfigUpdate(ConfigUpdatePayload {
            thread_id: "abc".into(),
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
        assert!(json.contains("thread:config-update"));
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
            thread_id: "abc".into(),
            content: "Management permissions have been granted.".into(),
        });
        let json = serde_json::to_string(&n).unwrap();
        assert!(json.contains("thread:system-message"));
        let restored: Notification = serde_json::from_str(&json).unwrap();
        match restored {
            Notification::SystemMessage(p) => {
                assert_eq!(p.thread_id, "abc");
                assert!(p.content.contains("Management permissions"));
            }
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn terminal_output_notification_roundtrips() {
        let n = Notification::TerminalOutput(TerminalOutputPayload {
            session_id: "sess-123".into(),
            data: b"hello world\n".to_vec(),
        });
        let json = serde_json::to_string(&n).unwrap();
        assert!(json.contains("terminal:output"));
        // data should be base64 encoded
        assert!(json.contains("aGVsbG8gd29ybGQK"));
        let restored: Notification = serde_json::from_str(&json).unwrap();
        match restored {
            Notification::TerminalOutput(p) => {
                assert_eq!(p.session_id, "sess-123");
                assert_eq!(p.data, b"hello world\n");
            }
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn terminal_exited_notification_roundtrips() {
        let n = Notification::TerminalExited(TerminalExitedPayload {
            session_id: "sess-456".into(),
        });
        let json = serde_json::to_string(&n).unwrap();
        assert!(json.contains("terminal:exited"));
        let restored: Notification = serde_json::from_str(&json).unwrap();
        match restored {
            Notification::TerminalExited(p) => assert_eq!(p.session_id, "sess-456"),
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn token_usage_notification_roundtrips() {
        let n = Notification::TokenUsage(ThreadTokenUsagePayload {
            thread_id: "t1".into(),
            used_tokens: 23_400,
            context_size: 200_000,
            cost_amount: None,
            cost_currency: None,
        });
        let json = serde_json::to_string(&n).unwrap();
        assert!(json.contains("thread:token-usage"));
        assert!(json.contains("23400"));
        let r: Notification = serde_json::from_str(&json).unwrap();
        match r {
            Notification::TokenUsage(p) => {
                assert_eq!(p.thread_id, "t1");
                assert_eq!(p.used_tokens, 23_400);
                assert_eq!(p.context_size, 200_000);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn session_ready_notification_roundtrips() {
        let n = Notification::SessionReady(SessionReadyPayload {
            thread_id: "thread-abc".into(),
            acp_session_id: "sess-xyz-123".into(),
        });
        let json = serde_json::to_string(&n).unwrap();
        assert!(json.contains("thread:session-ready"));
        assert!(json.contains("sess-xyz-123"));
        let restored: Notification = serde_json::from_str(&json).unwrap();
        match restored {
            Notification::SessionReady(p) => {
                assert_eq!(p.thread_id, "thread-abc");
                assert_eq!(p.acp_session_id, "sess-xyz-123");
            }
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn turn_dispatched_event_name_thread_id_and_roundtrip() {
        let n = Notification::TurnDispatched(TurnDispatchedPayload {
            thread_id: "t1".into(),
            user_text: Some("do the thing".into()),
            notifications: vec![QueuedMessageView {
                id: "m1".into(),
                source: "task".into(),
                from: None,
                task_id: Some("TSK-1".into()),
                task_status: Some("completed".into()),
                content: "done".into(),
                created_at: "2026-07-08T00:00:00Z".into(),
            }],
        });
        assert_eq!(n.event_name(), "thread:turn-dispatched");
        assert_eq!(n.thread_id(), Some("t1"));

        let json = serde_json::to_string(&n).unwrap();
        assert!(json.contains("thread:turn-dispatched"));
        assert!(json.contains("TSK-1"));

        let back: Notification = serde_json::from_str(&json).unwrap();
        assert_eq!(back.thread_id(), Some("t1"));
    }
}
