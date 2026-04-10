use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::WorkspaceId;

/// Lifecycle state of a task.
///
/// Encodes the invariant that `Pending` tasks have no session, while
/// `Working` and `Completed` always carry the thread ID of their session.
/// `Failed` may or may not carry one, because tasks can fail before any
/// thread is spawned (e.g., container not running at creation time).
///
/// Despite the field name, `session_id` stores the backend `thread_id`
/// returned by `AgentManager::spawn_thread`, not the underlying ACP
/// session ID. The naming is preserved for wire-format compatibility.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TaskState {
    Pending,
    Working {
        session_id: String,
    },
    Completed {
        session_id: String,
    },
    Failed {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
}

impl TaskState {
    /// Returns the thread ID of the task's session, if any.
    pub fn session_id(&self) -> Option<&str> {
        match self {
            TaskState::Pending => None,
            TaskState::Working { session_id } | TaskState::Completed { session_id } => {
                Some(session_id)
            }
            TaskState::Failed { session_id } => session_id.as_deref(),
        }
    }

    pub fn is_pending(&self) -> bool {
        matches!(self, TaskState::Pending)
    }

    pub fn is_working(&self) -> bool {
        matches!(self, TaskState::Working { .. })
    }

    pub fn is_completed(&self) -> bool {
        matches!(self, TaskState::Completed { .. })
    }

    pub fn is_failed(&self) -> bool {
        matches!(self, TaskState::Failed { .. })
    }

    /// A task is active if it is Pending or Working (not yet terminal).
    pub fn is_active(&self) -> bool {
        self.is_pending() || self.is_working()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    /// Lifecycle state. Flattened on the wire: serializes as a top-level
    /// `status` tag and, for non-Pending variants, a `session_id` field.
    #[serde(flatten)]
    pub state: TaskState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub blocker_ids: Vec<String>,
    pub agent_id: String,
    pub workspace_id: WorkspaceId,
    pub created_at: DateTime<Utc>,
}

impl Task {
    /// Convenience accessor for the current session thread ID, if any.
    pub fn session_id(&self) -> Option<&str> {
        self.state.session_id()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskPayload {
    pub task: Task,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_serializes_without_session_id() {
        let state = TaskState::Pending;
        let json = serde_json::to_string(&state).unwrap();
        assert_eq!(json, r#"{"status":"pending"}"#);
    }

    #[test]
    fn working_serializes_with_session_id() {
        let state = TaskState::Working {
            session_id: "abc12345".into(),
        };
        let json = serde_json::to_string(&state).unwrap();
        assert_eq!(json, r#"{"status":"working","session_id":"abc12345"}"#);
    }

    #[test]
    fn failed_without_session_id_omits_field() {
        let state = TaskState::Failed { session_id: None };
        let json = serde_json::to_string(&state).unwrap();
        assert_eq!(json, r#"{"status":"failed"}"#);
    }

    #[test]
    fn failed_with_session_id_includes_field() {
        let state = TaskState::Failed {
            session_id: Some("abc12345".into()),
        };
        let json = serde_json::to_string(&state).unwrap();
        assert_eq!(json, r#"{"status":"failed","session_id":"abc12345"}"#);
    }

    #[test]
    fn task_serializes_with_flattened_state() {
        let task = Task {
            id: "t1".into(),
            title: "do thing".into(),
            description: "desc".into(),
            state: TaskState::Working {
                session_id: "s1".into(),
            },
            parent_id: None,
            blocker_ids: vec![],
            agent_id: "a1".into(),
            workspace_id: WorkspaceId::from("ws1"),
            created_at: "2026-01-01T00:00:00Z".parse().unwrap(),
        };
        let json = serde_json::to_value(&task).unwrap();
        assert_eq!(json["status"], "working");
        assert_eq!(json["session_id"], "s1");
    }

    #[test]
    fn task_roundtrips_through_json() {
        let task = Task {
            id: "t1".into(),
            title: "x".into(),
            description: "y".into(),
            state: TaskState::Pending,
            parent_id: None,
            blocker_ids: vec![],
            agent_id: "a1".into(),
            workspace_id: WorkspaceId::from("ws1"),
            created_at: "2026-01-01T00:00:00Z".parse().unwrap(),
        };
        let json = serde_json::to_string(&task).unwrap();
        let parsed: Task = serde_json::from_str(&json).unwrap();
        assert!(parsed.state.is_pending());
        assert_eq!(parsed.session_id(), None);
    }
}
