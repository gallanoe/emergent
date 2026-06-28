pub mod paths;
mod state;
pub mod terminal;

pub use state::{
    new_shared_state, SharedWorkspaceState, Workspace, WorkspaceId, WorkspaceMetadata,
    WorkspaceState, WorkspaceStatus,
};

use std::path::PathBuf;

use emergent_protocol::{Notification, WorkspaceEntry, WorkspaceInfo, WorkspaceStatusChangePayload};
use tokio::sync::broadcast;

pub struct WorkspaceManager {
    state: SharedWorkspaceState,
    event_tx: broadcast::Sender<Notification>,
    workspaces_dir: PathBuf,
    terminal_sessions: terminal::TerminalSessions,
}

impl WorkspaceManager {
    pub async fn new(
        state: SharedWorkspaceState,
        event_tx: broadcast::Sender<Notification>,
    ) -> Self {
        Self {
            state,
            event_tx,
            workspaces_dir: crate::workspace::paths::emergent_root(),
            terminal_sessions: terminal::new_terminal_sessions(),
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn emit_status(&self, workspace_id: &WorkspaceId, status: WorkspaceStatus) {
        let _ = self.event_tx.send(Notification::WorkspaceStatusChange(
            WorkspaceStatusChangePayload {
                workspace_id: workspace_id.clone(),
                status,
            },
        ));
    }

    fn generate_id() -> String {
        use std::fmt::Write;
        let mut buf = [0u8; 4];
        getrandom::fill(&mut buf).expect("Failed to generate random bytes");
        let mut id = String::with_capacity(8);
        for byte in &buf {
            write!(id, "{:02x}", byte).unwrap();
        }
        id
    }

    // -----------------------------------------------------------------------
    // Startup
    // -----------------------------------------------------------------------

    pub async fn load_workspaces(&self) -> Result<(), String> {
        let dir = &self.workspaces_dir;
        if !dir.exists() {
            return Ok(());
        }

        let mut read_dir = tokio::fs::read_dir(dir)
            .await
            .map_err(|e| format!("Failed to read workspaces dir: {}", e))?;

        while let Some(entry) = read_dir
            .next_entry()
            .await
            .map_err(|e| format!("Failed to read dir entry: {}", e))?
        {
            let entry_path = entry.path();
            if !entry_path.is_dir() {
                continue;
            }

            let metadata_path = entry_path.join("metadata.json");
            if !metadata_path.exists() {
                continue;
            }

            let raw = tokio::fs::read_to_string(&metadata_path)
                .await
                .map_err(|e| format!("Failed to read metadata: {}", e))?;

            let metadata: WorkspaceMetadata = serde_json::from_str(&raw)
                .map_err(|e| format!("Failed to parse metadata: {}", e))?;

            let workspace_id = WorkspaceId(metadata.id.clone());

            // Workspaces are ready as soon as their directory exists.
            let workspace = Workspace {
                name: metadata.name,
                path: entry_path,
                status: WorkspaceStatus::Ready,
            };

            self.state
                .write()
                .await
                .workspaces
                .insert(workspace_id, workspace);
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // CRUD
    // -----------------------------------------------------------------------

    pub async fn create_workspace(&self, name: String) -> Result<WorkspaceId, String> {
        let id = Self::generate_id();
        let workspace_id = WorkspaceId(id.clone());
        let paths = crate::workspace::paths::WorkspacePaths::new(&workspace_id);
        let workspace_path = paths.dir().to_path_buf();

        // Create the workspace directory and its `agents/` parent. Each agent
        // runs as a local host process rooted in `agents/<agent-id>/`.
        tokio::fs::create_dir_all(paths.agents_dir())
            .await
            .map_err(|e| format!("Failed to create workspace dir: {}", e))?;

        // Write metadata.json
        let metadata = WorkspaceMetadata {
            id: id.clone(),
            name: name.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        let metadata_json = serde_json::to_string_pretty(&metadata)
            .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
        tokio::fs::write(paths.metadata_file(), metadata_json)
            .await
            .map_err(|e| format!("Failed to write metadata: {}", e))?;

        {
            let mut state = self.state.write().await;
            state.workspaces.insert(
                workspace_id.clone(),
                Workspace {
                    name,
                    path: workspace_path,
                    status: WorkspaceStatus::Ready,
                },
            );
        }
        self.emit_status(&workspace_id, WorkspaceStatus::Ready);

        Ok(workspace_id)
    }

    pub async fn delete_workspace(&self, id: &WorkspaceId) -> Result<(), String> {
        let workspace_path = {
            let state = self.state.read().await;
            state
                .workspaces
                .get(id)
                .map(|ws| ws.path.clone())
                .ok_or_else(|| format!("Workspace '{}' not found", id))?
        };

        terminal::close_sessions_for_workspace(&self.terminal_sessions, id).await;

        tokio::fs::remove_dir_all(&workspace_path)
            .await
            .map_err(|e| format!("Failed to remove workspace dir: {}", e))?;

        self.state.write().await.workspaces.remove(id);

        Ok(())
    }

    pub async fn list_workspaces(&self) -> Vec<WorkspaceEntry> {
        let state = self.state.read().await;
        state
            .workspaces
            .iter()
            .map(|(id, ws)| WorkspaceEntry {
                id: id.clone(),
                name: ws.name.clone(),
                status: ws.status.clone(),
            })
            .collect()
    }

    pub async fn get_workspace(&self, id: &WorkspaceId) -> Result<WorkspaceInfo, String> {
        let state = self.state.read().await;
        let ws = state
            .workspaces
            .get(id)
            .ok_or_else(|| format!("Workspace '{}' not found", id))?;

        Ok(WorkspaceInfo {
            id: id.clone(),
            name: ws.name.clone(),
            path: ws.path.to_string_lossy().into_owned(),
            status: ws.status.clone(),
        })
    }

    pub async fn update_workspace(&self, id: &WorkspaceId, name: String) -> Result<(), String> {
        let workspace_path = {
            let mut state = self.state.write().await;
            let ws = state
                .workspaces
                .get_mut(id)
                .ok_or_else(|| format!("Workspace '{}' not found", id))?;
            ws.name = name.clone();
            ws.path.clone()
        };

        let metadata_path = workspace_path.join("metadata.json");
        let raw = tokio::fs::read_to_string(&metadata_path)
            .await
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        let mut metadata: WorkspaceMetadata =
            serde_json::from_str(&raw).map_err(|e| format!("Failed to parse metadata: {}", e))?;

        metadata.name = name;

        let updated = serde_json::to_string_pretty(&metadata)
            .map_err(|e| format!("Failed to serialize metadata: {}", e))?;

        tokio::fs::write(metadata_path, updated)
            .await
            .map_err(|e| format!("Failed to write metadata: {}", e))?;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Terminal sessions (host PTY)
    // -----------------------------------------------------------------------

    pub async fn create_terminal_session(
        &self,
        workspace_id: &WorkspaceId,
    ) -> Result<String, String> {
        let cwd = {
            let state = self.state.read().await;
            state
                .workspaces
                .get(workspace_id)
                .map(|ws| ws.path.clone())
                .ok_or_else(|| format!("Workspace '{}' not found", workspace_id))?
        };

        let session = terminal::create_session(cwd, workspace_id.clone(), &self.event_tx).await?;

        let session_id = session.session_id.clone();
        self.terminal_sessions
            .lock()
            .await
            .insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn write_terminal(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.terminal_sessions.lock().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Terminal session '{}' not found", session_id))?;
        session.write(data).await
    }

    pub async fn resize_terminal(
        &self,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let sessions = self.terminal_sessions.lock().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| format!("Terminal session '{}' not found", session_id))?;
        session.resize(cols, rows)
    }

    pub async fn close_terminal_session(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.terminal_sessions.lock().await;
        let session = sessions
            .remove(session_id)
            .ok_or_else(|| format!("Terminal session '{}' not found", session_id))?;
        session.close();
        Ok(())
    }
}
