pub mod agent_manager;
pub mod detect;
pub mod server;
pub mod socket;

use agent_manager::AgentManager;
use std::sync::Arc;

/// Run the server accept loop. Used by both main() and integration tests.
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
