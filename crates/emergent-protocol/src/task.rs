use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::WorkspaceId;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Working,
    Completed,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub blocker_ids: Vec<String>,
    pub agent_id: String,
    /// Thread ID of the task's agent session.
    ///
    /// Despite the field name, this is the backend `thread_id` returned by
    /// `AgentManager::spawn_thread`, not the underlying ACP session ID. The
    /// frontend uses this to register and navigate to the thread.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub workspace_id: WorkspaceId,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskPayload {
    pub task: Task,
}
