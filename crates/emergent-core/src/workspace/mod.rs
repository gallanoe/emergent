pub mod container;
mod state;

pub use state::{
    new_shared_state, ContainerStatus, SharedWorkspaceState, Workspace, WorkspaceId,
    WorkspaceMetadata, WorkspaceState,
};

use std::path::PathBuf;

use bollard::Docker;
use emergent_protocol::{
    DockerStatus, Notification, WorkspaceEntry, WorkspaceInfo, WorkspaceStatusChangePayload,
};
use tokio::sync::broadcast;

const DEFAULT_DOCKERFILE: &str = "\
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y curl git && rm -rf /var/lib/apt/lists/*
CMD [\"sleep\", \"infinity\"]
";

pub struct WorkspaceManager {
    state: SharedWorkspaceState,
    event_tx: broadcast::Sender<Notification>,
    docker: Option<Docker>,
    docker_status: DockerStatus,
    workspaces_dir: PathBuf,
}

impl WorkspaceManager {
    pub async fn new(
        state: SharedWorkspaceState,
        event_tx: broadcast::Sender<Notification>,
        docker: Option<Docker>,
    ) -> Self {
        let docker_status = if let Some(ref d) = docker {
            container::detect_docker(d).await
        } else {
            DockerStatus {
                docker_available: false,
                docker_version: None,
            }
        };

        let workspaces_dir = dirs_home().join(".emergent").join("workspaces");

        Self {
            state,
            event_tx,
            docker,
            docker_status,
            workspaces_dir,
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Get a reference to the Docker client, if available.
    pub fn docker(&self) -> Option<&Docker> {
        self.docker.as_ref()
    }

    fn require_docker(&self) -> Result<&Docker, String> {
        self.docker
            .as_ref()
            .ok_or_else(|| "Docker is not available".to_string())
    }

    fn emit_status(&self, workspace_id: &WorkspaceId, status: ContainerStatus) {
        let _ = self
            .event_tx
            .send(Notification::WorkspaceStatusChange(WorkspaceStatusChangePayload {
                workspace_id: workspace_id.clone(),
                status,
            }));
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

    fn workspace_path(&self, id: &WorkspaceId) -> PathBuf {
        self.workspaces_dir.join(&id.0)
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

            let container_status = if let Some(docker) = &self.docker {
                container::inspect_container_status(docker, &workspace_id).await
            } else {
                ContainerStatus::Stopped
            };

            let workspace = Workspace {
                name: metadata.name,
                path: entry_path,
                container_id: None,
                container_status,
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
        let workspace_path = self.workspace_path(&workspace_id);

        // Create directory
        tokio::fs::create_dir_all(&workspace_path)
            .await
            .map_err(|e| format!("Failed to create workspace dir: {}", e))?;

        // VirtioFS workaround: touch the parent directory to force a metadata sync
        let parent = workspace_path
            .parent()
            .unwrap_or(&self.workspaces_dir)
            .to_owned();
        let now = filetime::FileTime::now();
        tokio::task::spawn_blocking(move || {
            filetime::set_file_mtime(&parent, now)
                .map_err(|e| format!("Failed to touch workspaces dir: {}", e))
        })
        .await
        .map_err(|e| format!("spawn_blocking error: {}", e))??;

        // Write default Dockerfile
        tokio::fs::write(workspace_path.join("Dockerfile"), DEFAULT_DOCKERFILE)
            .await
            .map_err(|e| format!("Failed to write Dockerfile: {}", e))?;

        // Write metadata.json
        let metadata = WorkspaceMetadata {
            id: id.clone(),
            name: name.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        let metadata_json = serde_json::to_string_pretty(&metadata)
            .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
        tokio::fs::write(workspace_path.join("metadata.json"), metadata_json)
            .await
            .map_err(|e| format!("Failed to write metadata: {}", e))?;

        // Insert into state as Building
        {
            let mut state = self.state.write().await;
            state.workspaces.insert(
                workspace_id.clone(),
                Workspace {
                    name: name.clone(),
                    path: workspace_path.clone(),
                    container_id: None,
                    container_status: ContainerStatus::Building,
                },
            );
        }
        self.emit_status(&workspace_id, ContainerStatus::Building);

        // Build container
        log::info!("Building container for workspace '{}'", workspace_id);
        if let Err(e) = self.build_container(&workspace_id).await {
            let error_status = ContainerStatus::Error { message: e.clone() };
            {
                let mut state = self.state.write().await;
                if let Some(ws) = state.workspaces.get_mut(&workspace_id) {
                    ws.container_status = error_status.clone();
                }
            }
            self.emit_status(&workspace_id, error_status);
            return Err(e);
        }

        // Start container
        log::info!("Starting container for workspace '{}'", workspace_id);
        if let Err(e) = self.start_container(&workspace_id).await {
            let error_status = ContainerStatus::Error { message: e.clone() };
            {
                let mut state = self.state.write().await;
                if let Some(ws) = state.workspaces.get_mut(&workspace_id) {
                    ws.container_status = error_status.clone();
                }
            }
            self.emit_status(&workspace_id, error_status);
            return Err(e);
        }

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

        // Stop and remove container if docker is available
        if let Some(docker) = &self.docker {
            let container_id = {
                let state = self.state.read().await;
                state
                    .workspaces
                    .get(id)
                    .and_then(|ws| ws.container_id.clone())
            };

            if let Some(cid) = container_id {
                let _ = container::stop_and_remove_container(docker, &cid).await;
            } else {
                // Try by name convention
                let name = container::container_name(id);
                let _ = container::stop_and_remove_container(docker, &name).await;
            }

            // Remove image
            let _ = container::remove_image(docker, id).await;
        }

        // Delete directory
        tokio::fs::remove_dir_all(&workspace_path)
            .await
            .map_err(|e| format!("Failed to remove workspace dir: {}", e))?;

        // Remove from state
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
                container_status: ws.container_status.clone(),
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
            container_id: ws.container_id.clone(),
            container_status: ws.container_status.clone(),
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

        // Update metadata.json
        let metadata_path = workspace_path.join("metadata.json");
        let raw = tokio::fs::read_to_string(&metadata_path)
            .await
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        let mut metadata: WorkspaceMetadata = serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse metadata: {}", e))?;

        metadata.name = name;

        let updated = serde_json::to_string_pretty(&metadata)
            .map_err(|e| format!("Failed to serialize metadata: {}", e))?;

        tokio::fs::write(metadata_path, updated)
            .await
            .map_err(|e| format!("Failed to write metadata: {}", e))?;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Container lifecycle
    // -----------------------------------------------------------------------

    pub async fn build_container(&self, id: &WorkspaceId) -> Result<(), String> {
        let docker = self.require_docker()?;
        let workspace_path = {
            let mut state = self.state.write().await;
            let ws = state
                .workspaces
                .get_mut(id)
                .ok_or_else(|| format!("Workspace '{}' not found", id))?;
            ws.container_status = ContainerStatus::Building;
            ws.path.clone()
        };

        self.emit_status(id, ContainerStatus::Building);

        container::build_image(docker, id, &workspace_path).await?;

        Ok(())
    }

    pub async fn start_container(&self, id: &WorkspaceId) -> Result<(), String> {
        let docker = self.require_docker()?;
        let workspace_path = {
            let state = self.state.read().await;
            state
                .workspaces
                .get(id)
                .map(|ws| ws.path.clone())
                .ok_or_else(|| format!("Workspace '{}' not found", id))?
        };

        let container_id =
            container::create_and_start_container(docker, id, &workspace_path).await?;

        {
            let mut state = self.state.write().await;
            if let Some(ws) = state.workspaces.get_mut(id) {
                ws.container_id = Some(container_id);
                ws.container_status = ContainerStatus::Running;
            }
        }

        self.emit_status(id, ContainerStatus::Running);

        Ok(())
    }

    pub async fn stop_container(&self, id: &WorkspaceId) -> Result<(), String> {
        let docker = self.require_docker()?;

        let container_id = {
            let state = self.state.read().await;
            state
                .workspaces
                .get(id)
                .and_then(|ws| ws.container_id.clone())
                .ok_or_else(|| format!("No running container for workspace '{}'", id))?
        };

        container::stop_and_remove_container(docker, &container_id).await?;

        {
            let mut state = self.state.write().await;
            if let Some(ws) = state.workspaces.get_mut(id) {
                ws.container_id = None;
                ws.container_status = ContainerStatus::Stopped;
            }
        }

        self.emit_status(id, ContainerStatus::Stopped);

        Ok(())
    }

    pub async fn rebuild_container(&self, id: &WorkspaceId) -> Result<(), String> {
        // Stop existing container if running
        let has_container = {
            let state = self.state.read().await;
            state
                .workspaces
                .get(id)
                .and_then(|ws| ws.container_id.as_ref())
                .is_some()
        };

        if has_container {
            self.stop_container(id).await?;
        }

        self.build_container(id).await?;
        self.start_container(id).await?;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Config
    // -----------------------------------------------------------------------

    pub async fn get_dockerfile(&self, id: &WorkspaceId) -> Result<String, String> {
        let workspace_path = {
            let state = self.state.read().await;
            state
                .workspaces
                .get(id)
                .map(|ws| ws.path.clone())
                .ok_or_else(|| format!("Workspace '{}' not found", id))?
        };

        tokio::fs::read_to_string(workspace_path.join("Dockerfile"))
            .await
            .map_err(|e| format!("Failed to read Dockerfile: {}", e))
    }

    // -----------------------------------------------------------------------
    // Docker detection
    // -----------------------------------------------------------------------

    pub fn detect_docker(&self) -> DockerStatus {
        self.docker_status.clone()
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}
