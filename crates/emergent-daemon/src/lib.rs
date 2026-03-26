pub mod agent_manager;
pub mod config;
pub mod detect;
pub mod mailbox;
pub mod mcp;
pub mod server;
pub mod socket;
pub mod system_prompt;
pub mod topology;

use agent_manager::AgentManager;
use emergent_protocol::TransportListener;
use std::sync::Arc;
use tokio::sync::Notify;

/// Run the server accept loop. Used by both main() and integration tests.
pub async fn run_server(
    listener: TransportListener,
    manager: Arc<AgentManager>,
    shutdown: Arc<Notify>,
) {
    loop {
        tokio::select! {
            accept = listener.accept() => {
                match accept {
                    Ok(stream) => {
                        let mgr = manager.clone();
                        let sd = shutdown.clone();
                        tokio::spawn(async move {
                            server::handle_client(stream, mgr, sd).await;
                        });
                    }
                    Err(e) => log::error!("Accept error: {}", e),
                }
            }
            _ = shutdown.notified() => break,
        }
    }
}
