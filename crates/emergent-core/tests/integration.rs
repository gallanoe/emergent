use emergent_core::agent::AgentManager;
use emergent_core::mcp::http_server;
use emergent_core::mcp::TokenRegistry;
use std::sync::Arc;

/// Spawn an MCP HTTP server backed by a fresh AgentManager.
async fn spawn_test_server() -> (String, Arc<TokenRegistry>, Arc<AgentManager>) {
    let registry = Arc::new(TokenRegistry::new());
    let manager = Arc::new(AgentManager::new(registry.clone()));
    let server = http_server::start(manager.clone(), registry.clone())
        .await
        .expect("failed to start HTTP server");
    manager.set_mcp_port(server.port);

    let base_url = format!("http://127.0.0.1:{}/mcp", server.port);
    (base_url, registry, manager)
}

fn mcp_init_body() -> String {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": { "name": "test", "version": "1.0" }
        }
    })
    .to_string()
}

fn mcp_tool_call(id: u64, name: &str, args: serde_json::Value) -> String {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "tools/call",
        "params": {
            "name": name,
            "arguments": args,
        }
    })
    .to_string()
}

/// Send a POST to the MCP endpoint and return the response body as text.
async fn post_mcp(
    client: &reqwest::Client,
    url: &str,
    body: String,
    token: Option<&str>,
) -> (u16, String) {
    let mut req = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream");

    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {}", t));
    }

    let resp = req.body(body).send().await.unwrap();
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap();
    (status, body)
}

#[tokio::test]
async fn test_initialize_succeeds() {
    let (url, _registry, _manager) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let (status, body) = post_mcp(&client, &url, mcp_init_body(), None).await;
    assert_eq!(status, 200);
    assert!(body.contains("\"result\""), "Expected result in: {}", body);
}

#[tokio::test]
async fn test_valid_token_can_list_peers() {
    let (url, registry, _manager) = spawn_test_server().await;
    let token = registry.register("test-agent-1");
    let client = reqwest::Client::new();

    // Initialize (stateless — no session needed)
    let (status, _) = post_mcp(&client, &url, mcp_init_body(), Some(&token)).await;
    assert_eq!(status, 200);

    // Call list_peers tool
    let (status, body) = post_mcp(
        &client,
        &url,
        mcp_tool_call(2, "list_peers", serde_json::json!({})),
        Some(&token),
    )
    .await;
    assert_eq!(status, 200);
    assert!(
        body.contains("result"),
        "Expected result in response, got: {}",
        body
    );
}

#[tokio::test]
async fn test_invalid_token_tool_call_returns_error() {
    let (url, _registry, _manager) = spawn_test_server().await;
    let client = reqwest::Client::new();

    // Tool call with bogus token should return an error in the result
    let (status, body) = post_mcp(
        &client,
        &url,
        mcp_tool_call(2, "list_peers", serde_json::json!({})),
        Some("bogus-token"),
    )
    .await;
    assert_eq!(status, 200); // MCP returns 200 with error in body
    assert!(
        body.contains("error") || body.contains("Invalid bearer token"),
        "Expected error in response, got: {}",
        body
    );
}

#[tokio::test]
async fn test_revoked_token_fails() {
    let (url, registry, _manager) = spawn_test_server().await;
    let token = registry.register("agent-to-kill");
    let client = reqwest::Client::new();

    // Verify token works first
    let (status, body) = post_mcp(
        &client,
        &url,
        mcp_tool_call(2, "list_peers", serde_json::json!({})),
        Some(&token),
    )
    .await;
    assert_eq!(status, 200);
    assert!(
        body.contains("result"),
        "Expected result before revocation, got: {}",
        body
    );

    // Revoke the token
    registry.revoke_agent("agent-to-kill");

    // Tool call should now fail
    let (status, body) = post_mcp(
        &client,
        &url,
        mcp_tool_call(3, "list_peers", serde_json::json!({})),
        Some(&token),
    )
    .await;
    assert_eq!(status, 200);
    assert!(
        body.contains("error") || body.contains("Invalid bearer token"),
        "Expected error after token revocation, got: {}",
        body
    );
}

#[tokio::test]
async fn test_no_auth_header_tool_call_returns_error() {
    let (url, _registry, _manager) = spawn_test_server().await;
    let client = reqwest::Client::new();

    // Tool call without any auth header
    let (status, body) = post_mcp(
        &client,
        &url,
        mcp_tool_call(2, "list_peers", serde_json::json!({})),
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert!(
        body.contains("error") || body.contains("Authorization"),
        "Expected auth error in response, got: {}",
        body
    );
}
