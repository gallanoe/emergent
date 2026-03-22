mod socket;

#[tokio::main]
async fn main() {
    env_logger::init();

    let sock_path = socket::socket_path();
    log::info!("Socket path: {}", sock_path.display());

    // Check for existing daemon
    if socket::is_daemon_running(&sock_path).await {
        eprintln!(
            "Error: daemon is already running on {}",
            sock_path.display()
        );
        std::process::exit(1);
    }

    // Clean up stale socket
    socket::remove_stale_socket(&sock_path).expect("Failed to remove stale socket");

    // Ensure parent directory exists
    if let Some(parent) = sock_path.parent() {
        std::fs::create_dir_all(parent).expect("Failed to create socket directory");
    }

    // Write PID file
    let _pid_path = socket::write_pid_file(&sock_path).expect("Failed to write PID file");

    let _listener =
        tokio::net::UnixListener::bind(&sock_path).expect("Failed to bind Unix socket");

    log::info!("emergentd listening on {}", sock_path.display());

    // Wait for Ctrl+C
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to listen for ctrl_c");

    log::info!("Shutting down");
    socket::remove_stale_socket(&sock_path).ok();
    socket::remove_pid_file(&sock_path);
}
