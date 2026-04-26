pub mod container;
mod state;
pub mod stats;
pub mod terminal;

pub use state::{
    new_shared_state, ContainerStatus, SharedWorkspaceState, Workspace, WorkspaceId,
    WorkspaceMetadata, WorkspaceState,
};

use std::collections::HashMap;
use std::path::PathBuf;

use emergent_protocol::{
    ContainerRuntimePreference, ContainerRuntimeStatus, Notification, WorkspaceEntry,
    WorkspaceInfo, WorkspaceStatusChangePayload,
};
use tokio::sync::{broadcast, Mutex};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

const DEFAULT_DOCKERFILE: &str = "\
FROM ubuntu:24.04

ARG NODE_VERSION=22.14.0
ARG BUN_VERSION=1.2.13
ARG CLAUDE_CODE_VERSION=1.0.33
ARG CODEX_VERSION=0.52.0

# System dependencies
RUN apt-get update && apt-get install -y ca-certificates curl git gh unzip xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Node.js (pinned version, direct official tarball)
RUN case \"$(dpkg --print-architecture)\" in \
        amd64) node_arch=\"x64\" ;; \
        arm64) node_arch=\"arm64\" ;; \
        *) echo \"Unsupported architecture: $(dpkg --print-architecture)\" && exit 1 ;; \
    esac \
    && curl -fsSL \"https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz\" -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm -f /tmp/node.tar.xz

# Bun (pinned version, direct release artifact)
RUN case \"$(dpkg --print-architecture)\" in \
        amd64) bun_arch=\"x64\" ;; \
        arm64) bun_arch=\"aarch64\" ;; \
        *) echo \"Unsupported architecture: $(dpkg --print-architecture)\" && exit 1 ;; \
    esac \
    && curl -fsSL \"https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${bun_arch}.zip\" -o /tmp/bun.zip \
    && unzip /tmp/bun.zip -d /tmp \
    && install -m 0755 \"/tmp/bun-linux-${bun_arch}/bun\" /usr/local/bin/bun \
    && ln -sf /usr/local/bin/bun /usr/local/bin/bunx \
    && rm -rf /tmp/bun.zip \"/tmp/bun-linux-${bun_arch}\"

# Pinned agent CLIs installed from npm packages instead of remote shell scripts
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} @openai/codex@${CODEX_VERSION}

CMD [\"sleep\", \"infinity\"]
";

type StatPollers = Mutex<HashMap<WorkspaceId, (JoinHandle<()>, CancellationToken)>>;

pub struct WorkspaceManager {
    state: SharedWorkspaceState,
    event_tx: broadcast::Sender<Notification>,
    runtime: crate::runtime::SharedRuntime,
    workspaces_dir: PathBuf,
    terminal_sessions: terminal::TerminalSessions,
    stat_pollers: StatPollers,
}

impl WorkspaceManager {
    pub async fn new(
        state: SharedWorkspaceState,
        event_tx: broadcast::Sender<Notification>,
        runtime: crate::runtime::SharedRuntime,
    ) -> Self {
        let workspaces_dir = dirs_home().join(".emergent").join("workspaces");

        Self {
            state,
            event_tx,
            runtime,
            workspaces_dir,
            terminal_sessions: terminal::new_terminal_sessions(),
            stat_pollers: Mutex::new(HashMap::new()),
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    pub async fn runtime_client(&self) -> Option<bollard::Docker> {
        self.runtime.read().await.client()
    }

    async fn require_runtime_client(&self) -> Result<bollard::Docker, String> {
        let runtime = self.runtime.read().await;
        runtime.client().ok_or_else(|| {
            let status = runtime.status();
            status
                .message
                .unwrap_or_else(|| format!("{} is not available", status.selected_runtime))
        })
    }

    async fn container_extra_hosts(&self) -> Option<Vec<String>> {
        self.runtime.read().await.container_extra_hosts()
    }

    async fn cancel_stat_poller(&self, workspace_id: &WorkspaceId) {
        if let Some((handle, token)) = self.stat_pollers.lock().await.remove(workspace_id) {
            token.cancel();
            handle.abort();
        }
    }

    /// Start a stats poller for `workspace_id` if one is not already running.
    ///
    /// This is idempotent: if `stat_pollers` already contains an entry for this
    /// workspace the function returns immediately without touching the existing
    /// poller. Use `cancel_stat_poller` first when you need to force-restart
    /// (e.g. after a container restart).
    async fn ensure_stat_poller(&self, workspace_id: &WorkspaceId, container_name: &str) {
        // Check under lock, then release before doing async work.
        {
            let pollers = self.stat_pollers.lock().await;
            if pollers.contains_key(workspace_id) {
                return;
            }
        }
        if let Some(docker) = self.runtime_client().await {
            let (handle, token) = stats::ContainerStatsPoller::start(
                workspace_id.clone(),
                container_name.to_owned(),
                docker,
                self.event_tx.clone(),
            );
            self.stat_pollers
                .lock()
                .await
                .insert(workspace_id.clone(), (handle, token));
        }
    }

    fn emit_status(&self, workspace_id: &WorkspaceId, status: ContainerStatus) {
        let _ = self.event_tx.send(Notification::WorkspaceStatusChange(
            WorkspaceStatusChangePayload {
                workspace_id: workspace_id.clone(),
                status,
            },
        ));
    }

    async fn set_workspace_status(&self, workspace_id: &WorkspaceId, status: ContainerStatus) {
        {
            let mut state = self.state.write().await;
            if let Some(workspace) = state.workspaces.get_mut(workspace_id) {
                if !matches!(status, ContainerStatus::Running) {
                    workspace.container_id = None;
                }
                workspace.container_status = status.clone();
            } else {
                return;
            }
        }

        self.emit_status(workspace_id, status);
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

    async fn refresh_workspace_runtime_status(&self) {
        let client = self.runtime_client().await;
        let workspace_ids: Vec<WorkspaceId> = {
            let state = self.state.read().await;
            state.workspaces.keys().cloned().collect()
        };

        for workspace_id in workspace_ids {
            let status = if let Some(ref client) = client {
                container::inspect_container_status(client, &workspace_id).await
            } else {
                ContainerStatus::Stopped
            };

            {
                let mut state = self.state.write().await;
                if let Some(workspace) = state.workspaces.get_mut(&workspace_id) {
                    workspace.container_id = if status == ContainerStatus::Running {
                        Some(container::container_name(&workspace_id))
                    } else {
                        None
                    };
                    workspace.container_status = status.clone();
                }
            }

            if status == ContainerStatus::Running {
                let container_name = container::container_name(&workspace_id);
                self.ensure_stat_poller(&workspace_id, &container_name).await;
            } else {
                self.cancel_stat_poller(&workspace_id).await;
            }

            self.emit_status(&workspace_id, status);
        }
    }

    pub async fn get_container_runtime_status(&self) -> ContainerRuntimeStatus {
        self.runtime.read().await.status()
    }

    pub async fn get_container_runtime_preference(&self) -> ContainerRuntimePreference {
        self.runtime.read().await.preference()
    }

    pub async fn set_container_runtime_preference(
        &self,
        preference: ContainerRuntimePreference,
    ) -> Result<ContainerRuntimeStatus, String> {
        let status = crate::runtime::update_shared_runtime(&self.runtime, preference).await?;
        self.refresh_workspace_runtime_status().await;
        Ok(status)
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

            let client = self.runtime_client().await;
            let (container_status, container_id) = if let Some(client) = client {
                let status = container::inspect_container_status(&client, &workspace_id).await;
                let cid = if status == ContainerStatus::Running {
                    Some(container::container_name(&workspace_id))
                } else {
                    None
                };
                (status, cid)
            } else {
                (ContainerStatus::Stopped, None)
            };

            let is_running = container_status == ContainerStatus::Running;

            let workspace = Workspace {
                name: metadata.name,
                path: entry_path,
                container_id,
                container_status,
            };

            self.state
                .write()
                .await
                .workspaces
                .insert(workspace_id.clone(), workspace);

            if is_running {
                let container_name = container::container_name(&workspace_id);
                self.ensure_stat_poller(&workspace_id, &container_name).await;
            }
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

        // Create directory and `home/` subdirectory (the mount point for the container)
        tokio::fs::create_dir_all(&workspace_path)
            .await
            .map_err(|e| format!("Failed to create workspace dir: {}", e))?;
        tokio::fs::create_dir_all(workspace_path.join("home/workspace"))
            .await
            .map_err(|e| format!("Failed to create workspace dir: {}", e))?;
        tokio::fs::create_dir_all(workspace_path.join("home/.agents"))
            .await
            .map_err(|e| format!("Failed to create agents dir: {}", e))?;

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

        let state = self.state.clone();
        let event_tx = self.event_tx.clone();
        let runtime = self.runtime.clone();
        let workspace_id_for_task = workspace_id.clone();
        let workspace_path_for_task = workspace_path.clone();
        tokio::spawn(async move {
            log::info!(
                "Building container for workspace '{}'",
                workspace_id_for_task
            );

            let build_result = match runtime.read().await.client() {
                Some(client) => {
                    container::build_image(
                        &client,
                        &workspace_id_for_task,
                        &workspace_path_for_task,
                    )
                    .await
                }
                None => {
                    let status = runtime.read().await.status();
                    Err(status.message.unwrap_or_else(|| {
                        format!("{} is not available", status.selected_runtime)
                    }))
                }
            };

            let next_status = match build_result {
                Ok(_) => ContainerStatus::Stopped,
                Err(message) => ContainerStatus::Error { message },
            };

            {
                let mut state = state.write().await;
                if let Some(ws) = state.workspaces.get_mut(&workspace_id_for_task) {
                    ws.container_status = next_status.clone();
                } else {
                    return;
                }
            }

            let _ = event_tx.send(Notification::WorkspaceStatusChange(
                WorkspaceStatusChangePayload {
                    workspace_id: workspace_id_for_task,
                    status: next_status,
                },
            ));
        });

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

        // Stop stats poller and terminal sessions before removing the container
        self.cancel_stat_poller(id).await;
        terminal::close_sessions_for_workspace(&self.terminal_sessions, id).await;

        // Stop and remove container if the selected runtime is available.
        if let Some(client) = self.runtime_client().await {
            let container_id = {
                let state = self.state.read().await;
                state
                    .workspaces
                    .get(id)
                    .and_then(|ws| ws.container_id.clone())
            };

            if let Some(cid) = container_id {
                let _ = container::stop_and_remove_container(&client, &cid).await;
            } else {
                // Try by name convention
                let name = container::container_name(id);
                let _ = container::stop_and_remove_container(&client, &name).await;
            }

            // Remove image
            let _ = container::remove_image(&client, id).await;
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
    // Container lifecycle
    // -----------------------------------------------------------------------

    pub async fn build_container(&self, id: &WorkspaceId) -> Result<(), String> {
        let result: Result<(), String> = async {
            let client = self.require_runtime_client().await?;
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

            container::build_image(&client, id, &workspace_path).await?;

            Ok(())
        }
        .await;

        if let Err(ref message) = result {
            self.set_workspace_status(
                id,
                ContainerStatus::Error {
                    message: message.clone(),
                },
            )
            .await;
        }

        result
    }

    pub async fn start_container(&self, id: &WorkspaceId) -> Result<(), String> {
        let result: Result<(), String> = async {
            let client = self.require_runtime_client().await?;
            let workspace_path = {
                let state = self.state.read().await;
                state
                    .workspaces
                    .get(id)
                    .map(|ws| ws.path.clone())
                    .ok_or_else(|| format!("Workspace '{}' not found", id))?
            };

            if !container::image_exists(&client, id).await {
                {
                    let mut state = self.state.write().await;
                    if let Some(ws) = state.workspaces.get_mut(id) {
                        ws.container_status = ContainerStatus::Building;
                    }
                }
                self.emit_status(id, ContainerStatus::Building);
                container::build_image(&client, id, &workspace_path).await?;
            }

            let extra_hosts = self.container_extra_hosts().await;
            let container_id = container::create_and_start_container(
                &client,
                id,
                &workspace_path,
                extra_hosts,
            )
            .await?;

            // Set up workspace symlinks in all existing agent directories
            if let Err(e) = container::setup_agent_symlinks(&client, &container_id).await {
                log::warn!(
                    "Failed to set up agent symlinks for workspace '{}': {}",
                    id,
                    e
                );
            }

            {
                let mut state = self.state.write().await;
                if let Some(ws) = state.workspaces.get_mut(id) {
                    ws.container_id = Some(container_id);
                    ws.container_status = ContainerStatus::Running;
                }
            }

            self.emit_status(id, ContainerStatus::Running);

            // Cancel any existing poller for this workspace (handles re-entrancy
            // from a container restart) then start a fresh one.
            self.cancel_stat_poller(id).await;
            let container_name = container::container_name(id);
            self.ensure_stat_poller(id, &container_name).await;

            Ok(())
        }
        .await;

        if let Err(ref message) = result {
            self.set_workspace_status(
                id,
                ContainerStatus::Error {
                    message: message.clone(),
                },
            )
            .await;
        }

        result
    }

    pub async fn stop_container(&self, id: &WorkspaceId) -> Result<(), String> {
        let client = self.require_runtime_client().await?;

        let container_id = {
            let state = self.state.read().await;
            state
                .workspaces
                .get(id)
                .and_then(|ws| ws.container_id.clone())
                .ok_or_else(|| format!("No running container for workspace '{}'", id))?
        };

        // Stop stats poller and terminal sessions before removing the container
        self.cancel_stat_poller(id).await;
        terminal::close_sessions_for_workspace(&self.terminal_sessions, id).await;

        container::stop_and_remove_container(&client, &container_id).await?;

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
    // Runtime status
    // -----------------------------------------------------------------------

    pub async fn create_terminal_session(
        &self,
        workspace_id: &WorkspaceId,
    ) -> Result<String, String> {
        let client = self.require_runtime_client().await?;
        let container_id = {
            let state = self.state.read().await;
            state
                .workspaces
                .get(workspace_id)
                .and_then(|ws| ws.container_id.clone())
                .ok_or_else(|| format!("No running container for workspace '{}'", workspace_id))?
        };

        let session =
            terminal::create_session(&client, &container_id, workspace_id.clone(), &self.event_tx)
                .await?;

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
        let client = self.require_runtime_client().await?;
        let exec_id = {
            let sessions = self.terminal_sessions.lock().await;
            sessions
                .get(session_id)
                .map(|s| s.exec_id.clone())
                .ok_or_else(|| format!("Terminal session '{}' not found", session_id))?
        };
        terminal::TerminalSession::resize(&client, &exec_id, cols, rows).await
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

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}
