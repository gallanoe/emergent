pub mod paths;
mod state;
pub mod terminal;

pub use state::{
    new_shared_state, SharedWorkspaceState, Workspace, WorkspaceId, WorkspaceMetadata,
    WorkspaceState, WorkspaceStatus,
};

use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;

use emergent_protocol::{Notification, WorkspaceEntry, WorkspaceInfo, WorkspaceStatusChangePayload};
use tokio::sync::broadcast;

pub struct WorkspaceManager {
    state: SharedWorkspaceState,
    event_tx: broadcast::Sender<Notification>,
    workspaces_dir: PathBuf,
    terminal_sessions: terminal::TerminalSessions,
    /// Terminal output is delivered through this sink (straight to the Tauri
    /// layer) instead of the shared `event_tx` broadcast, so a flooding terminal
    /// cannot evict unrelated agent notifications.
    terminal_sink: Arc<dyn terminal::TerminalEventSink>,
}

impl WorkspaceManager {
    pub async fn new(
        state: SharedWorkspaceState,
        event_tx: broadcast::Sender<Notification>,
        terminal_sink: Arc<dyn terminal::TerminalEventSink>,
    ) -> Self {
        Self {
            state,
            event_tx,
            workspaces_dir: crate::workspace::paths::emergent_root(),
            terminal_sessions: terminal::new_terminal_sessions(),
            terminal_sink,
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

        // Per-entry failures must not abort loading the rest — one corrupt
        // metadata.json should hide only that workspace, not all of them.
        loop {
            let entry = match read_dir.next_entry().await {
                Ok(Some(entry)) => entry,
                Ok(None) => break,
                Err(e) => {
                    log::warn!("Stopping workspace scan: failed to read dir entry: {}", e);
                    break;
                }
            };

            let entry_path = entry.path();
            if !entry_path.is_dir() {
                continue;
            }

            let metadata_path = entry_path.join("metadata.json");
            if !metadata_path.exists() {
                continue;
            }

            let raw = match tokio::fs::read_to_string(&metadata_path).await {
                Ok(raw) => raw,
                Err(e) => {
                    log::warn!(
                        "Skipping workspace '{}': cannot read metadata.json: {}",
                        entry_path.display(),
                        e
                    );
                    continue;
                }
            };

            let metadata: WorkspaceMetadata = match serde_json::from_str(&raw) {
                Ok(m) => m,
                Err(e) => {
                    log::warn!(
                        "Skipping workspace '{}': malformed metadata.json: {}",
                        entry_path.display(),
                        e
                    );
                    continue;
                }
            };

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

        terminal::close_sessions_for_workspace(&self.terminal_sessions, id);

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
            let state = self.state.read().await;
            state
                .workspaces
                .get(id)
                .map(|ws| ws.path.clone())
                .ok_or_else(|| format!("Workspace '{}' not found", id))?
        };

        // Persist metadata.json first; only reflect the rename in memory once
        // the durable write succeeds, so a failed write can't diverge state.
        let metadata_path = workspace_path.join("metadata.json");
        let raw = tokio::fs::read_to_string(&metadata_path)
            .await
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        let mut metadata: WorkspaceMetadata =
            serde_json::from_str(&raw).map_err(|e| format!("Failed to parse metadata: {}", e))?;

        metadata.name = name.clone();

        let updated = serde_json::to_string_pretty(&metadata)
            .map_err(|e| format!("Failed to serialize metadata: {}", e))?;

        tokio::fs::write(metadata_path, updated)
            .await
            .map_err(|e| format!("Failed to write metadata: {}", e))?;

        if let Some(ws) = self.state.write().await.workspaces.get_mut(id) {
            ws.name = name;
        }

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

        terminal::create_session(
            &self.terminal_sessions,
            cwd,
            workspace_id.clone(),
            self.terminal_sink.clone(),
        )
        .await
    }

    pub async fn write_terminal(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        // Clone the writer handle under a brief map lock, then release the map
        // lock before the blocking write so one stuck terminal can't wedge all
        // terminal operations.
        let writer = {
            let map = self.terminal_sessions.lock().unwrap();
            map.get(session_id)
                .map(|s| s.writer_handle())
                .ok_or_else(|| format!("Terminal session '{}' not found", session_id))?
        };
        let data = data.to_vec();
        tokio::task::spawn_blocking(move || {
            let mut w = writer
                .lock()
                .map_err(|_| "terminal writer poisoned".to_string())?;
            w.write_all(&data)
                .map_err(|e| format!("Failed to write to terminal: {}", e))?;
            w.flush()
                .map_err(|e| format!("Failed to flush terminal: {}", e))
        })
        .await
        .map_err(|e| format!("terminal write task failed: {}", e))?
    }

    pub async fn resize_terminal(
        &self,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let map = self.terminal_sessions.lock().unwrap();
        let session = map
            .get(session_id)
            .ok_or_else(|| format!("Terminal session '{}' not found", session_id))?;
        session.resize(cols, rows)
    }

    pub async fn close_terminal_session(&self, session_id: &str) -> Result<(), String> {
        let session = {
            let mut map = self.terminal_sessions.lock().unwrap();
            map.remove(session_id)
        };
        match session {
            Some(s) => {
                s.close();
                Ok(())
            }
            None => Err(format!("Terminal session '{}' not found", session_id)),
        }
    }

    /// Close every terminal session (kills each shell's process group). Called
    /// on application shutdown so host shells don't outlive the app.
    pub fn close_all_terminal_sessions(&self) {
        terminal::close_all_sessions(&self.terminal_sessions);
    }
}
