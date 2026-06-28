//! On-disk path layout for Emergent workspaces and agents.
//!
//! Agents run as local host processes (no containers). Each agent is rooted in
//! its own directory, which doubles as its `$HOME` and working directory so that
//! per-agent config (`.claude`, `.codex`, …) stays isolated from other agents.
//!
//! ```text
//! ~/.emergent/
//! └── <workspace-id>/
//!     ├── metadata.json  agents.json  threads.json  tasks.json
//!     └── agents/
//!         └── <agent-id>/   # the agent's $HOME and cwd
//! ```

use std::path::{Path, PathBuf};

use emergent_protocol::WorkspaceId;

/// The user's home directory, falling back to the current directory.
pub fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// Root directory holding all Emergent state: `~/.emergent`.
pub fn emergent_root() -> PathBuf {
    home_dir().join(".emergent")
}

/// Resolves the on-disk layout for a single workspace.
#[derive(Clone, Debug)]
pub struct WorkspacePaths {
    dir: PathBuf,
}

impl WorkspacePaths {
    /// Paths for `workspace_id` rooted under `~/.emergent`.
    pub fn new(workspace_id: &WorkspaceId) -> Self {
        Self {
            dir: emergent_root().join(&workspace_id.0),
        }
    }

    /// Wrap an already-resolved workspace directory.
    pub fn from_dir(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// The workspace directory: `~/.emergent/<workspace-id>`.
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// `~/.emergent/<workspace-id>/metadata.json`.
    pub fn metadata_file(&self) -> PathBuf {
        self.dir.join("metadata.json")
    }

    /// The directory holding all agent homes: `~/.emergent/<workspace-id>/agents`.
    pub fn agents_dir(&self) -> PathBuf {
        self.dir.join("agents")
    }

    /// A single agent's `$HOME`/cwd: `~/.emergent/<workspace-id>/agents/<agent-id>`.
    pub fn agent_dir(&self, agent_id: &str) -> PathBuf {
        self.dir.join("agents").join(agent_id)
    }
}
