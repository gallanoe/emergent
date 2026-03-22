use std::path::PathBuf;

// Re-export socket_path from the shared protocol crate
pub use emergent_protocol::socket_path;

/// Check if a daemon is already listening on the socket/pipe.
/// Returns true if a connection succeeds within 500ms.
pub async fn is_daemon_running(path: &std::path::Path) -> bool {
    tokio::time::timeout(
        std::time::Duration::from_millis(500),
        emergent_protocol::transport::connect(path),
    )
    .await
    .map(|r| r.is_ok())
    .unwrap_or(false)
}

/// Remove a stale socket file if it exists.
/// No-op concept on Windows (named pipes are kernel-managed).
#[cfg(unix)]
pub fn remove_stale_socket(path: &std::path::Path) -> std::io::Result<()> {
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

/// Write a PID file alongside the socket.
pub fn write_pid_file(socket_path: &std::path::Path) -> std::io::Result<PathBuf> {
    let pid_path = pid_path(socket_path);
    if let Some(parent) = pid_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&pid_path, std::process::id().to_string())?;
    Ok(pid_path)
}

/// Remove the PID file.
pub fn remove_pid_file(socket_path: &std::path::Path) {
    let _ = std::fs::remove_file(pid_path(socket_path));
}

/// Resolve PID file path.
/// On unix: sibling of the socket file (e.g. `emergentd.pid`).
/// On Windows: in temp dir (pipe paths are virtual, no parent dir).
fn pid_path(socket_path: &std::path::Path) -> PathBuf {
    #[cfg(unix)]
    {
        socket_path.with_extension("pid")
    }
    #[cfg(windows)]
    {
        let name = socket_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "emergentd".into());
        std::env::temp_dir().join(format!("{}.pid", name))
    }
}
