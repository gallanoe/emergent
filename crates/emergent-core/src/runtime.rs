use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use async_trait::async_trait;
use bollard::{API_DEFAULT_VERSION, Docker};
use emergent_protocol::{
    ContainerRuntimeKind, ContainerRuntimePreference, ContainerRuntimeStatus,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

pub type SharedRuntime = Arc<RwLock<RuntimeContext>>;

const DEFAULT_TIMEOUT_SECS: u64 = 120;

#[async_trait]
pub trait ContainerRuntimeAdapter: Send + Sync {
    fn kind(&self) -> ContainerRuntimeKind;
    fn cli_program(&self) -> &'static str;
    fn mcp_host_alias(&self) -> &'static str;
    fn container_extra_hosts(&self) -> Option<Vec<String>>;
    fn connect_client(&self) -> Result<Docker, String>;

    async fn detect_status(&self) -> ContainerRuntimeStatus {
        match self.connect_client() {
            Ok(client) => match client.version().await {
                Ok(version) => ContainerRuntimeStatus {
                    selected_runtime: self.kind(),
                    available: true,
                    version: version.version,
                    message: None,
                },
                Err(e) => ContainerRuntimeStatus {
                    selected_runtime: self.kind(),
                    available: false,
                    version: None,
                    message: Some(format!("Failed to query runtime version: {}", e)),
                },
            },
            Err(message) => ContainerRuntimeStatus {
                selected_runtime: self.kind(),
                available: false,
                version: None,
                message: Some(message),
            },
        }
    }
}

pub struct DockerRuntimeAdapter;

#[async_trait]
impl ContainerRuntimeAdapter for DockerRuntimeAdapter {
    fn kind(&self) -> ContainerRuntimeKind {
        ContainerRuntimeKind::Docker
    }

    fn cli_program(&self) -> &'static str {
        "docker"
    }

    fn mcp_host_alias(&self) -> &'static str {
        "host.docker.internal"
    }

    fn container_extra_hosts(&self) -> Option<Vec<String>> {
        if cfg!(target_os = "linux") {
            Some(vec!["host.docker.internal:host-gateway".to_string()])
        } else {
            None
        }
    }

    fn connect_client(&self) -> Result<Docker, String> {
        Docker::connect_with_local_defaults()
            .map_err(|e| format!("Docker is unavailable: {}", e))
    }
}

pub struct PodmanRuntimeAdapter;

#[async_trait]
impl ContainerRuntimeAdapter for PodmanRuntimeAdapter {
    fn kind(&self) -> ContainerRuntimeKind {
        ContainerRuntimeKind::Podman
    }

    fn cli_program(&self) -> &'static str {
        "podman"
    }

    fn mcp_host_alias(&self) -> &'static str {
        "host.containers.internal"
    }

    fn container_extra_hosts(&self) -> Option<Vec<String>> {
        None
    }

    fn connect_client(&self) -> Result<Docker, String> {
        let endpoint = resolve_podman_endpoint()?;
        connect_client_for_endpoint(&endpoint)
    }
}

pub struct RuntimeContext {
    preference: ContainerRuntimePreference,
    adapter: Arc<dyn ContainerRuntimeAdapter>,
    client: Option<Docker>,
    status: ContainerRuntimeStatus,
}

impl RuntimeContext {
    pub async fn from_preference(preference: ContainerRuntimePreference) -> Self {
        let adapter = adapter_for_kind(&preference.selected_runtime);
        let status = adapter.detect_status().await;
        let client = if status.available {
            match adapter.connect_client() {
                Ok(client) => Some(client),
                Err(e) => {
                    log::warn!("Failed to create runtime client after successful status check: {}", e);
                    None
                }
            }
        } else {
            None
        };

        Self {
            preference,
            adapter,
            client,
            status,
        }
    }

    pub fn preference(&self) -> ContainerRuntimePreference {
        self.preference.clone()
    }

    pub fn status(&self) -> ContainerRuntimeStatus {
        self.status.clone()
    }

    pub fn client(&self) -> Option<Docker> {
        self.client.clone()
    }

    pub fn cli_program(&self) -> &'static str {
        self.adapter.cli_program()
    }

    pub fn mcp_host_alias(&self) -> &'static str {
        self.adapter.mcp_host_alias()
    }

    pub fn container_extra_hosts(&self) -> Option<Vec<String>> {
        self.adapter.container_extra_hosts()
    }
}

pub async fn load_shared_runtime() -> SharedRuntime {
    let preference = load_runtime_preference().await.unwrap_or_default();
    Arc::new(RwLock::new(
        RuntimeContext::from_preference(preference).await,
    ))
}

pub async fn update_shared_runtime(
    runtime: &SharedRuntime,
    preference: ContainerRuntimePreference,
) -> Result<ContainerRuntimeStatus, String> {
    save_runtime_preference(&preference).await?;
    let next = RuntimeContext::from_preference(preference).await;
    let status = next.status();
    *runtime.write().await = next;
    Ok(status)
}

pub async fn load_runtime_preference() -> Result<ContainerRuntimePreference, String> {
    load_runtime_preference_from_path(&config_path()).await
}

pub async fn save_runtime_preference(
    preference: &ContainerRuntimePreference,
) -> Result<(), String> {
    save_runtime_preference_to_path(&config_path(), preference).await
}

async fn load_runtime_preference_from_path(
    path: &Path,
) -> Result<ContainerRuntimePreference, String> {
    match tokio::fs::read_to_string(path).await {
        Ok(raw) => {
            let config: AppConfig = serde_json::from_str(&raw)
                .map_err(|e| format!("Failed to parse runtime config: {}", e))?;
            Ok(ContainerRuntimePreference {
                selected_runtime: config.selected_runtime,
            })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(ContainerRuntimePreference::default()),
        Err(e) => Err(format!("Failed to read runtime config: {}", e)),
    }
}

async fn save_runtime_preference_to_path(
    path: &Path,
    preference: &ContainerRuntimePreference,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create runtime config dir: {}", e))?;
    }

    let raw = serde_json::to_string_pretty(&AppConfig {
        selected_runtime: preference.selected_runtime.clone(),
    })
    .map_err(|e| format!("Failed to serialize runtime config: {}", e))?;

    tokio::fs::write(path, raw)
        .await
        .map_err(|e| format!("Failed to write runtime config: {}", e))
}

fn adapter_for_kind(kind: &ContainerRuntimeKind) -> Arc<dyn ContainerRuntimeAdapter> {
    match kind {
        ContainerRuntimeKind::Docker => Arc::new(DockerRuntimeAdapter),
        ContainerRuntimeKind::Podman => Arc::new(PodmanRuntimeAdapter),
    }
}

fn connect_client_for_endpoint(endpoint: &str) -> Result<Docker, String> {
    if let Some(path) = endpoint.strip_prefix("unix://") {
        Docker::connect_with_unix(path, DEFAULT_TIMEOUT_SECS, API_DEFAULT_VERSION)
            .map_err(|e| format!("Failed to connect to runtime socket '{}': {}", endpoint, e))
    } else if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
        Docker::connect_with_http(endpoint, DEFAULT_TIMEOUT_SECS, API_DEFAULT_VERSION)
            .map_err(|e| format!("Failed to connect to runtime endpoint '{}': {}", endpoint, e))
    } else if let Some(host) = endpoint.strip_prefix("tcp://") {
        let url = format!("http://{}", host);
        Docker::connect_with_http(&url, DEFAULT_TIMEOUT_SECS, API_DEFAULT_VERSION)
            .map_err(|e| format!("Failed to connect to runtime endpoint '{}': {}", endpoint, e))
    } else if endpoint.starts_with('/') {
        Docker::connect_with_unix(endpoint, DEFAULT_TIMEOUT_SECS, API_DEFAULT_VERSION)
            .map_err(|e| format!("Failed to connect to runtime socket '{}': {}", endpoint, e))
    } else {
        Err(format!(
            "Unsupported container runtime endpoint '{}'; expected unix:// or http://",
            endpoint
        ))
    }
}

fn resolve_podman_endpoint() -> Result<String, String> {
    if let Ok(host) = std::env::var("PODMAN_HOST") {
        return Ok(host);
    }

    for candidate in podman_socket_candidates() {
        if candidate.exists() {
            return Ok(format!("unix://{}", candidate.display()));
        }
    }

    if let Some(uri) = podman_connection_uri_from_cli() {
        return Ok(uri);
    }

    Err("Podman is unavailable: no local compat API endpoint was found".to_string())
}

fn podman_socket_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(dir) = std::env::var("XDG_RUNTIME_DIR") {
        candidates.push(PathBuf::from(dir).join("podman/podman.sock"));
    }

    candidates.push(PathBuf::from("/run/podman/podman.sock"));

    let home = dirs_home();
    candidates.push(home.join(".local/share/containers/podman/machine/podman.sock"));
    candidates.extend(find_podman_machine_sockets(
        &home.join(".local/share/containers/podman/machine"),
    ));

    candidates
}

fn find_podman_machine_sockets(root: &Path) -> Vec<PathBuf> {
    let mut sockets = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return sockets;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            sockets.extend(find_podman_machine_sockets(&path));
        } else if path.file_name().and_then(|n| n.to_str()) == Some("podman.sock") {
            sockets.push(path);
        }
    }

    sockets
}

fn podman_connection_uri_from_cli() -> Option<String> {
    let output = Command::new("podman")
        .args(["system", "connection", "list", "--format", "json"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let value: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    let entries = value.as_array()?;

    let preferred = entries
        .iter()
        .find(|entry| entry.get("Default").and_then(|v| v.as_bool()) == Some(true))
        .or_else(|| entries.first())?;

    preferred
        .get("URI")
        .and_then(|v| v.as_str())
        .map(ToString::to_string)
}

fn config_path() -> PathBuf {
    dirs_home().join(".emergent").join("config.json")
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct AppConfig {
    #[serde(default)]
    selected_runtime: ContainerRuntimeKind,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn runtime_preference_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let preference = ContainerRuntimePreference {
            selected_runtime: ContainerRuntimeKind::Podman,
        };

        save_runtime_preference_to_path(&path, &preference)
            .await
            .unwrap();

        let loaded = load_runtime_preference_from_path(&path).await.unwrap();
        assert!(matches!(
            loaded.selected_runtime,
            ContainerRuntimeKind::Podman
        ));
    }

    #[test]
    fn docker_adapter_values_are_stable() {
        let adapter = DockerRuntimeAdapter;
        assert_eq!(adapter.cli_program(), "docker");
        assert_eq!(adapter.mcp_host_alias(), "host.docker.internal");
        if cfg!(target_os = "linux") {
            assert_eq!(
                adapter.container_extra_hosts(),
                Some(vec!["host.docker.internal:host-gateway".to_string()])
            );
        } else {
            assert_eq!(adapter.container_extra_hosts(), None);
        }
    }

    #[test]
    fn podman_adapter_values_are_stable() {
        let adapter = PodmanRuntimeAdapter;
        assert_eq!(adapter.cli_program(), "podman");
        assert_eq!(adapter.mcp_host_alias(), "host.containers.internal");
        assert_eq!(adapter.container_extra_hosts(), None);
    }
}
