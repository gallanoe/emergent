use std::path::PathBuf;

// Re-export socket_path from the shared protocol crate
pub use emergent_protocol::socket_path;

/// Check if a daemon is already listening on the socket.
/// Returns true if a connection succeeds within 500ms.
pub async fn is_daemon_running(path: &std::path::Path) -> bool {
    tokio::time::timeout(
        std::time::Duration::from_millis(500),
        tokio::net::UnixStream::connect(path),
    )
    .await
    .map(|r| r.is_ok())
    .unwrap_or(false)
}

/// Remove a stale socket file if it exists.
pub fn remove_stale_socket(path: &std::path::Path) -> std::io::Result<()> {
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

/// Write a PID file alongside the socket.
pub fn write_pid_file(socket_path: &std::path::Path) -> std::io::Result<PathBuf> {
    let pid_path = socket_path.with_extension("pid");
    std::fs::write(&pid_path, std::process::id().to_string())?;
    Ok(pid_path)
}

/// Remove the PID file.
pub fn remove_pid_file(socket_path: &std::path::Path) {
    let pid_path = socket_path.with_extension("pid");
    let _ = std::fs::remove_file(pid_path);
}
