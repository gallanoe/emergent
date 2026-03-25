use emergent_daemon::agent_manager::AgentManager;
use emergent_daemon::socket;
use emergent_protocol::TransportListener;
use std::sync::Arc;
use tokio::sync::Notify;

#[tokio::main]
async fn main() {
    env_logger::init();

    let args: Vec<String> = std::env::args().collect();

    // Check for --mcp-stdio mode
    if args.iter().any(|a| a == "--mcp-stdio") {
        let agent_id = args
            .iter()
            .find_map(|a| a.strip_prefix("--agent-id="))
            .expect("--mcp-stdio requires --agent-id=<id>")
            .to_string();
        let socket_path = args
            .iter()
            .find_map(|a| a.strip_prefix("--socket="))
            .map(std::path::PathBuf::from)
            .unwrap_or_else(socket::socket_path);

        emergent_daemon::mcp::run_mcp_stdio(agent_id, socket_path).await;
        return;
    }

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

    // Clean up stale socket (unix only — named pipes are kernel-managed)
    #[cfg(unix)]
    socket::remove_stale_socket(&sock_path).expect("Failed to remove stale socket");

    // Ensure parent directory exists (unix only — pipe paths are virtual)
    #[cfg(unix)]
    if let Some(parent) = sock_path.parent() {
        std::fs::create_dir_all(parent).expect("Failed to create socket directory");
    }

    // Write PID file
    let _pid_path = socket::write_pid_file(&sock_path).expect("Failed to write PID file");

    let listener = TransportListener::bind(&sock_path).expect("Failed to bind listener");

    log::info!("emergentd listening on {}", sock_path.display());

    let manager = Arc::new(AgentManager::new());

    // Accept connections until shutdown signal
    let shutdown = Arc::new(Notify::new());
    let shutdown_for_server = shutdown.clone();
    let sock_path_clone = sock_path.clone();

    tokio::select! {
        _ = emergent_daemon::run_server(listener, manager.clone(), shutdown_for_server) => {}
        _ = tokio::signal::ctrl_c() => {
            log::info!("Received shutdown signal");
            shutdown.notify_one();
        }
    }

    // Graceful shutdown: kill all agents with timeout
    log::info!("Shutting down agents...");
    let agents = manager.list_agents().await;
    for agent in &agents {
        let _ = manager.kill_agent(&agent.id).await;
    }

    #[cfg(unix)]
    socket::remove_stale_socket(&sock_path_clone).ok();
    socket::remove_pid_file(&sock_path_clone);
    log::info!("emergentd stopped");
}
