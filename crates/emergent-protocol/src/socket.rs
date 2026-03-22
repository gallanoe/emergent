use std::path::PathBuf;

/// Resolve the daemon socket/pipe path.
/// Priority: EMERGENT_SOCKET env > platform default.
pub fn socket_path() -> PathBuf {
    if let Ok(p) = std::env::var("EMERGENT_SOCKET") {
        return PathBuf::from(p);
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(dir) = dirs::runtime_dir() {
            return dir.join("emergent").join("emergentd.sock");
        }
    }

    #[cfg(unix)]
    {
        // macOS and Linux fallback: use $TMPDIR/emergent-<uid>/
        let uid = unsafe { libc::getuid() };
        std::env::temp_dir()
            .join(format!("emergent-{}", uid))
            .join("emergentd.sock")
    }

    #[cfg(windows)]
    {
        // Windows: named pipe in kernel namespace
        let username = std::env::var("USERNAME").unwrap_or_else(|_| "default".into());
        PathBuf::from(format!(r"\\.\pipe\emergent-{}", username))
    }
}
