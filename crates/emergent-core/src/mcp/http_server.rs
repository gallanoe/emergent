use std::sync::Arc;

use axum::Router;
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use tokio_util::sync::CancellationToken;

use crate::agent::AgentManager;
use super::handler::McpHandler;
use super::token_registry::TokenRegistry;

/// Handle returned after starting the HTTP server.
pub struct McpHttpServer {
    pub port: u16,
    pub cancellation_token: CancellationToken,
}

/// Start the MCP HTTP server on `127.0.0.1:0` (random port).
///
/// Returns the `McpHttpServer` with the bound port and a cancellation token.
/// The server runs as a background tokio task.
pub async fn start(
    manager: Arc<AgentManager>,
    token_registry: Arc<TokenRegistry>,
) -> Result<McpHttpServer, String> {
    let ct = CancellationToken::new();

    let config = StreamableHttpServerConfig {
        stateful_mode: false,
        json_response: true,
        sse_keep_alive: None,
        cancellation_token: ct.child_token(),
        ..Default::default()
    };

    let mgr = manager.clone();
    let reg = token_registry.clone();

    let service: StreamableHttpService<McpHandler, LocalSessionManager> =
        StreamableHttpService::new(
            move || Ok(McpHandler::new(mgr.clone(), reg.clone())),
            Default::default(),
            config,
        );

    let router = Router::new().nest_service("/mcp", service);

    let tcp_listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind HTTP server: {}", e))?;
    let port = tcp_listener
        .local_addr()
        .map_err(|e| format!("Failed to get local addr: {}", e))?
        .port();

    log::info!("MCP HTTP server listening on 127.0.0.1:{}", port);

    let ct_for_shutdown = ct.child_token();
    tokio::spawn(async move {
        let _ = axum::serve(tcp_listener, router)
            .with_graceful_shutdown(async move { ct_for_shutdown.cancelled().await })
            .await;
    });

    Ok(McpHttpServer {
        port,
        cancellation_token: ct,
    })
}
