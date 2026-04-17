use emergent_core::agent::AgentManager;
use emergent_core::mcp::http_server;
use emergent_core::mcp::TokenRegistry;
use emergent_core::task::TaskManager;
use emergent_core::workspace;
use std::sync::Arc;

/// Spawn an MCP HTTP server backed by a fresh AgentManager.
async fn spawn_test_server() -> (String, Arc<TokenRegistry>, Arc<AgentManager>) {
    let registry = Arc::new(TokenRegistry::new());
    let workspace_state = workspace::new_shared_state();
    let (event_tx, _) = tokio::sync::broadcast::channel(1024);
    let runtime = emergent_core::runtime::load_shared_runtime().await;
    let manager = Arc::new(AgentManager::new(
        workspace_state,
        event_tx.clone(),
        registry.clone(),
        runtime,
    ));
    let task_manager = Arc::new(TaskManager::new(manager.clone(), event_tx));
    let server = http_server::start(manager.clone(), registry.clone(), task_manager)
        .await
        .expect("failed to start HTTP server");
    manager.set_mcp_port(server.port).await;

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
async fn test_valid_token_can_list_tools() {
    let (url, registry, _manager) = spawn_test_server().await;
    let token = registry.register("test-agent-1", None);
    let client = reqwest::Client::new();

    // Initialize (stateless — no session needed)
    let (status, _) = post_mcp(&client, &url, mcp_init_body(), Some(&token)).await;
    assert_eq!(status, 200);

    // List tools — should return empty list
    let list_body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    })
    .to_string();
    let (status, body) = post_mcp(&client, &url, list_body, Some(&token)).await;
    assert_eq!(status, 200);
    assert!(
        body.contains("result"),
        "Expected result in response, got: {}",
        body
    );
    assert!(
        body.contains("\"tools\""),
        "Expected tools list in response, got: {}",
        body
    );
}

#[tokio::test]
async fn test_list_tools_hides_complete_task_for_conversation_session() {
    // Tokens minted without a task_id belong to conversation sessions.
    // `complete_task` must not appear in the advertised tool list — the LLM
    // should never see a tool it can't usefully call.
    let (url, registry, _manager) = spawn_test_server().await;
    let token = registry.register("conversation-agent", None);
    let client = reqwest::Client::new();

    let (status, _) = post_mcp(&client, &url, mcp_init_body(), Some(&token)).await;
    assert_eq!(status, 200);

    let list_body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    })
    .to_string();
    let (status, body) = post_mcp(&client, &url, list_body, Some(&token)).await;
    assert_eq!(status, 200);
    assert!(
        body.contains("\"create_task\""),
        "Expected create_task in tool list, got: {}",
        body
    );
    assert!(
        !body.contains("\"complete_task\""),
        "complete_task must be hidden for conversation sessions, got: {}",
        body
    );
}

#[tokio::test]
async fn test_list_tools_shows_complete_task_for_task_session() {
    // Tokens minted with a task_id belong to task sessions. `complete_task`
    // must be visible immediately — including during the ACP handshake, before
    // any ThreadHandle is inserted into the threads map.
    let (url, registry, _manager) = spawn_test_server().await;
    let token = registry.register("task-agent", Some("task-42".to_string()));
    let client = reqwest::Client::new();

    let (status, _) = post_mcp(&client, &url, mcp_init_body(), Some(&token)).await;
    assert_eq!(status, 200);

    let list_body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    })
    .to_string();
    let (status, body) = post_mcp(&client, &url, list_body, Some(&token)).await;
    assert_eq!(status, 200);
    assert!(
        body.contains("\"complete_task\""),
        "complete_task must be visible for task sessions, got: {}",
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
    let token = registry.register("agent-to-kill", None);
    let client = reqwest::Client::new();

    // Verify token works: list tools should succeed
    let list_body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    })
    .to_string();
    let (status, body) = post_mcp(&client, &url, list_body.clone(), Some(&token)).await;
    assert_eq!(status, 200);
    assert!(
        body.contains("result"),
        "Expected result before revocation, got: {}",
        body
    );

    // Revoke the token
    registry.revoke_agent("agent-to-kill");

    // Calling a nonexistent tool should fail (token revoked)
    let (status, body) = post_mcp(
        &client,
        &url,
        mcp_tool_call(3, "nonexistent_tool", serde_json::json!({})),
        Some(&token),
    )
    .await;
    assert_eq!(status, 200);
    assert!(
        body.contains("error"),
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

#[tokio::test]
async fn task_session_survives_restart_and_respawn() {
    use emergent_core::agent::thread_manager::{ThreadManager, ThreadMapping};
    use emergent_protocol::{ContainerStatus, WorkspaceId};
    use tempfile::TempDir;

    let tmp = TempDir::new().unwrap();
    let ws_id = WorkspaceId::from("it-ws-restart");

    // First manager: persist a dormant entry to disk (stand-in for a
    // completed task's session mapping).
    {
        let (_, _tr, manager) = spawn_test_server().await;
        manager
            .thread_manager()
            .register_workspace_for_test(
                ws_id.clone(),
                tmp.path().to_path_buf(),
                ContainerStatus::Stopped,
            )
            .await;

        manager
            .thread_manager()
            .hydrate_dormant_for_workspace(
                &ws_id,
                vec![ThreadMapping {
                    thread_id: "completed-task-session".into(),
                    agent_definition_id: "agent-x".into(),
                    acp_session_id: Some("acp-completed".into()),
                    task_id: Some("task-done".into()),
                }],
            )
            .await;
        manager
            .thread_manager()
            .persist_threads_for_workspace(&ws_id)
            .await;

        let on_disk = ThreadManager::load_from_dir(tmp.path()).await.unwrap();
        assert_eq!(on_disk.len(), 1);
    }

    // "Restart": fresh manager, hydrate from disk, then trigger a persist
    // (as a new spawn would). The dormant entry must survive.
    let (_, _tr, manager2) = spawn_test_server().await;
    manager2
        .thread_manager()
        .register_workspace_for_test(
            ws_id.clone(),
            tmp.path().to_path_buf(),
            ContainerStatus::Stopped,
        )
        .await;

    let mappings = ThreadManager::load_from_dir(tmp.path()).await.unwrap();
    manager2
        .thread_manager()
        .hydrate_dormant_for_workspace(&ws_id, mappings)
        .await;

    manager2
        .thread_manager()
        .persist_threads_for_workspace(&ws_id)
        .await;

    let after_restart = ThreadManager::load_from_dir(tmp.path()).await.unwrap();
    assert_eq!(after_restart.len(), 1);
    assert_eq!(after_restart[0].thread_id, "completed-task-session");

    let summaries = manager2.thread_manager().list_threads("agent-x").await;
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].status, "dead");
}
