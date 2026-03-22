mod agent_manager;
mod detect;
pub mod server;
mod socket;

use agent_manager::AgentManager;
use std::sync::Arc;

/// Run the server accept loop. Extracted for testability.
pub async fn run_server(
    listener: tokio::net::UnixListener,
    manager: Arc<AgentManager>,
    mut shutdown_rx: tokio::sync::oneshot::Receiver<()>,
) {
    loop {
        tokio::select! {
            accept = listener.accept() => {
                match accept {
                    Ok((stream, _)) => {
                        let mgr = manager.clone();
                        tokio::spawn(async move {
                            server::handle_client(stream, mgr).await;
                        });
                    }
                    Err(e) => log::error!("Accept error: {}", e),
                }
            }
            _ = &mut shutdown_rx => break,
        }
    }
}

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

    let listener =
        tokio::net::UnixListener::bind(&sock_path).expect("Failed to bind Unix socket");

    log::info!("emergentd listening on {}", sock_path.display());

    let manager = Arc::new(AgentManager::new());

    // Accept connections until shutdown signal
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    let sock_path_clone = sock_path.clone();

    tokio::select! {
        _ = run_server(listener, manager.clone(), shutdown_rx) => {}
        _ = tokio::signal::ctrl_c() => {
            log::info!("Received shutdown signal");
            let _ = shutdown_tx.send(());
        }
    }

    // Graceful shutdown: kill all agents with timeout
    log::info!("Shutting down agents...");
    let agents = manager.list_agents().await;
    for agent in &agents {
        let _ = manager.kill_agent(&agent.id).await;
    }

    socket::remove_stale_socket(&sock_path_clone).ok();
    socket::remove_pid_file(&sock_path_clone);
    log::info!("emergentd stopped");
}
