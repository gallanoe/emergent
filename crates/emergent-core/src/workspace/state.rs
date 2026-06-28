use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::RwLock;

pub use emergent_protocol::{WorkspaceId, WorkspaceStatus};

pub struct Workspace {
    pub name: String,
    pub path: PathBuf,
    pub status: WorkspaceStatus,
}

pub struct WorkspaceState {
    pub workspaces: HashMap<WorkspaceId, Workspace>,
}

impl WorkspaceState {
    pub fn new() -> Self {
        Self {
            workspaces: HashMap::new(),
        }
    }
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self::new()
    }
}

pub type SharedWorkspaceState = Arc<RwLock<WorkspaceState>>;

pub fn new_shared_state() -> SharedWorkspaceState {
    Arc::new(RwLock::new(WorkspaceState::new()))
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct WorkspaceMetadata {
    pub id: String,
    pub name: String,
    pub created_at: String,
}
