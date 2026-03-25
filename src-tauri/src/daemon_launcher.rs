use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

/// Errors that can occur when launching the daemon.
#[derive(Debug)]
pub enum LaunchError {
    BinaryNotFound,
    SpawnFailed(String),
    Timeout,
}

impl std::fmt::Display for LaunchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BinaryNotFound => write!(
                f,
                "Could not find emergentd binary. Ensure it is built or in PATH."
            ),
            Self::SpawnFailed(e) => write!(f, "Failed to spawn emergentd: {}", e),
            Self::Timeout => write!(
                f,
                "Daemon was spawned but did not become reachable within 5 seconds"
            ),
        }
    }
}

/// Find the `emergentd` binary.
/// 1. Sibling of the current executable (dev: target/debug/, release: Tauri strips
///    the target-triple suffix so the bundled sidecar is just `emergentd`)
/// 2. Fall back to PATH lookup
pub fn find_daemon_binary() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("emergentd");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    which::which("emergentd").ok()
}

/// Ensure the daemon is running. Spawns it if not already reachable.
pub async fn ensure_daemon_running() -> Result<(), LaunchError> {
    let socket_path = emergent_protocol::socket_path();

    if is_reachable(&socket_path).await {
        log::info!("Daemon already running");
        return Ok(());
    }

    let binary = find_daemon_binary().ok_or(LaunchError::BinaryNotFound)?;
    log::info!("Spawning daemon from: {}", binary.display());

    Command::new(&binary)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| LaunchError::SpawnFailed(e.to_string()))?;

    // Poll until reachable (100ms intervals, 5s timeout)
    for i in 0..50 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if is_reachable(&socket_path).await {
            log::info!("Daemon ready after {}ms", (i + 1) * 100);
            return Ok(());
        }
    }

    Err(LaunchError::Timeout)
}

/// Best-effort shutdown: connect and send shutdown RPC.
/// Returns Ok if daemon shuts down or is already unreachable.
pub async fn shutdown_daemon() -> Result<(), String> {
    let socket_path = emergent_protocol::socket_path();

    if !is_reachable(&socket_path).await {
        return Ok(()); // Already down
    }

    let (client, _rx) = emergent_protocol::DaemonClient::connect(&socket_path)
        .await
        .map_err(|e| e.to_string())?;

    // Send shutdown — treat connection close as success
    match client.shutdown().await {
        Ok(()) => Ok(()),
        Err(e) => {
            // Connection closed = daemon is shutting down = success
            if e.contains("closed") || e.contains("broken pipe") {
                Ok(())
            } else {
                Err(e)
            }
        }
    }
}

async fn is_reachable(socket_path: &std::path::Path) -> bool {
    tokio::time::timeout(
        Duration::from_millis(500),
        emergent_protocol::transport::connect(socket_path),
    )
    .await
    .map(|r| r.is_ok())
    .unwrap_or(false)
}
