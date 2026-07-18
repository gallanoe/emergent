use emergent_protocol::AgentProvider;
use emergent_core::agent::AgentManager;
use emergent_core::mcp::http_server;
use emergent_core::mcp::TokenRegistry;
use emergent_core::task::TaskManager;
use emergent_core::workspace;
use emergent_protocol::Notification;
use std::sync::Arc;
use tokio::sync::broadcast;

/// Spawn an MCP HTTP server backed by a fresh AgentManager, also returning the
/// broadcast sender so a test can `subscribe()` to thread notifications
/// (message chunks, tool-call updates, prompt-complete).
async fn spawn_test_server_with_events() -> (
    String,
    Arc<TokenRegistry>,
    Arc<AgentManager>,
    broadcast::Sender<Notification>,
) {
    let registry = Arc::new(TokenRegistry::new());
    let workspace_state = workspace::new_shared_state();
    let (event_tx, _) = broadcast::channel(1024);
    let manager = Arc::new(AgentManager::new(
        workspace_state,
        event_tx.clone(),
        registry.clone(),
    ));
    let task_manager = Arc::new(TaskManager::new(manager.clone(), event_tx.clone()));
    let server = http_server::start(manager.clone(), registry.clone(), task_manager)
        .await
        .expect("failed to start HTTP server");
    manager.set_mcp_port(server.port).await;

    let base_url = format!("http://127.0.0.1:{}/mcp", server.port);
    (base_url, registry, manager, event_tx)
}

/// Spawn an MCP HTTP server backed by a fresh AgentManager.
async fn spawn_test_server() -> (String, Arc<TokenRegistry>, Arc<AgentManager>) {
    let (url, registry, manager, _event_tx) = spawn_test_server_with_events().await;
    (url, registry, manager)
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
async fn test_list_tools_hides_update_task_for_conversation_session() {
    // `update_task` must not appear for conversation sessions — it is only
    // meaningful inside task sessions.
    let (url, registry, _manager) = spawn_test_server().await;
    let token = registry.register("conversation-agent-2", None);
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
        !body.contains("\"update_task\""),
        "update_task must be hidden for conversation sessions, got: {}",
        body
    );
}

#[tokio::test]
async fn test_list_tools_shows_update_task_for_task_session() {
    // `update_task` must appear for task sessions.
    let (url, registry, _manager) = spawn_test_server().await;
    let token = registry.register("task-agent-2", Some("task-99".to_string()));
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
        body.contains("\"update_task\""),
        "update_task must be visible for task sessions, got: {}",
        body
    );
}

#[tokio::test]
async fn test_list_tools_shows_search_tools_for_conversation_session() {
    // The read-only search tools are available to every session, including
    // plain conversation sessions (no task_id).
    let (url, registry, _manager) = spawn_test_server().await;
    let token = registry.register("search-agent", None);
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
        body.contains("\"search_tasks\""),
        "search_tasks must be visible, got: {}",
        body
    );
    assert!(
        body.contains("\"search_conversations\""),
        "search_conversations must be visible, got: {}",
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
    use emergent_protocol::WorkspaceId;
    use tempfile::TempDir;

    let tmp = TempDir::new().unwrap();
    let ws_id = WorkspaceId::from("it-ws-restart");

    // First manager: persist a dormant entry to disk (stand-in for a
    // completed task's session mapping).
    {
        let (_, _tr, manager) = spawn_test_server().await;
        manager
            .thread_manager()
            .register_workspace_for_test(ws_id.clone(), tmp.path().to_path_buf())
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
        .register_workspace_for_test(ws_id.clone(), tmp.path().to_path_buf())
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

#[tokio::test]
async fn delete_workspace_clears_dormant_in_memory() {
    use emergent_core::agent::thread_manager::ThreadMapping;
    use emergent_protocol::WorkspaceId;
    use tempfile::TempDir;

    let tmp = TempDir::new().unwrap();
    let ws_id = WorkspaceId::from("it-ws-delete");

    let (_, _tr, manager) = spawn_test_server().await;
    manager
        .thread_manager()
        .register_workspace_for_test(ws_id.clone(), tmp.path().to_path_buf())
        .await;

    manager
        .thread_manager()
        .hydrate_dormant_for_workspace(
            &ws_id,
            vec![ThreadMapping {
                thread_id: "dorm-del".into(),
                agent_definition_id: "agent-x".into(),
                acp_session_id: Some("acp-del".into()),
                task_id: None,
            }],
        )
        .await;

    assert_eq!(
        manager
            .thread_manager()
            .dormant_snapshot_for_workspace(&ws_id)
            .await
            .len(),
        1
    );

    // This is what commands::delete_workspace invokes first.
    manager.kill_threads_in_workspace(&ws_id).await.unwrap();

    assert!(manager
        .thread_manager()
        .dormant_snapshot_for_workspace(&ws_id)
        .await
        .is_empty());
}

// ---------------------------------------------------------------------------
// Step 9.5: TurnUsage extraction pipeline test
// ---------------------------------------------------------------------------
// Verifies the path: Notification::TurnUsage → recorder → in-memory store →
// persist to threads.json → reload round-trip.
// Does not require Docker or a live mock-agent process.

#[tokio::test]
async fn turn_usage_recorder_updates_store_and_persists() {
    use emergent_core::agent::thread_manager::ThreadMapping;
    use emergent_core::agent::usage_store::PersistedWorkspaceState;
    use emergent_protocol::{Notification, TurnUsagePayload, WorkspaceId};
    use tempfile::TempDir;

    let tmp = TempDir::new().unwrap();
    let ws_id = WorkspaceId::from("it-ws-usage");

    let (_, _tr, manager) = spawn_test_server().await;
    manager
        .thread_manager()
        .register_workspace_for_test(ws_id.clone(), tmp.path().to_path_buf())
        .await;

    // Hydrate a dormant thread so persist_threads_for_workspace has something to write.
    manager
        .thread_manager()
        .hydrate_dormant_for_workspace(
            &ws_id,
            vec![ThreadMapping {
                thread_id: "t-usage-1".into(),
                agent_definition_id: "agent-usage".into(),
                acp_session_id: Some("sess-usage-1".into()),
                task_id: None,
            }],
        )
        .await;

    // Simulate what the recorder background task does when it receives a
    // TurnUsage notification: apply a delta to the in-memory store.
    {
        use emergent_core::agent::usage_store::TurnDelta;

        let delta = TurnDelta {
            input_tokens: 1200,
            output_tokens: 280,
            total_tokens: 1480,
            ..Default::default()
        };

        manager
            .thread_manager()
            .apply_usage_delta_for_test(&ws_id, "agent-usage", &delta, "2026-04-25T10:34:00Z")
            .await;
    }

    // Verify the in-memory store was updated before persistence.
    {
        let snap = manager.thread_manager().get_workspace_usage(&ws_id).await;
        assert_eq!(snap.agents.len(), 1);
        assert_eq!(snap.agents[0].turn_count, 1);
        assert_eq!(snap.agents[0].total_tokens, 1480);
    }

    // Persist to disk
    manager
        .thread_manager()
        .persist_threads_for_workspace(&ws_id)
        .await;

    // (a) Confirm TurnUsage-shaped notification serialises correctly
    let payload = TurnUsagePayload {
        thread_id: "t-usage-1".into(),
        workspace_id: ws_id.0.clone(),
        agent_definition_id: "agent-usage".into(),
        input_tokens: 1200,
        output_tokens: 280,
        cached_read_tokens: 0,
        cached_write_tokens: 0,
        thought_tokens: 0,
        total_tokens: 1480,
        at: "2026-04-25T10:34:00Z".into(),
    };
    let notif = Notification::TurnUsage(payload);
    assert_eq!(notif.event_name(), "thread:turn-usage");
    match &notif {
        Notification::TurnUsage(p) => assert_eq!(p.total_tokens, 1480),
        _ => panic!("wrong variant"),
    }

    // (c) threads.json round-trip: file written with v1 schema + usage
    let raw = tokio::fs::read_to_string(tmp.path().join("threads.json"))
        .await
        .unwrap();
    let state: PersistedWorkspaceState = serde_json::from_str(&raw).unwrap();
    assert_eq!(state.schema_version, 1);
    assert_eq!(state.threads.len(), 1);
    assert_eq!(state.threads[0].thread_id, "t-usage-1");
    assert_eq!(state.usage.agents.len(), 1);
    assert_eq!(state.usage.agents[0].agent_definition_id, "agent-usage");
    assert_eq!(state.usage.agents[0].total_tokens, 1480);

    // (d) Seed usage from disk into a fresh manager, verify loaded
    let (_, _tr2, manager2) = spawn_test_server().await;
    manager2
        .thread_manager()
        .register_workspace_for_test(ws_id.clone(), tmp.path().to_path_buf())
        .await;
    manager2
        .thread_manager()
        .seed_usage_from_dir(&ws_id, tmp.path())
        .await;
    let reloaded = manager2.thread_manager().get_workspace_usage(&ws_id).await;
    assert_eq!(reloaded.agents.len(), 1);
    assert_eq!(reloaded.agents[0].total_tokens, 1480);
}

#[tokio::test]
async fn v0_threads_json_loads_with_empty_usage() {
    // Ensures backward-compat: old bare-array threads.json loads without error
    // and populates an empty WorkspaceUsageStore.
    use emergent_core::agent::thread_manager::ThreadManager;
    use tempfile::TempDir;

    let tmp = TempDir::new().unwrap();
    let v0_json = r#"[{"thread_id":"old-t1","agent_definition_id":"agent-old","acp_session_id":"sess-1","task_id":null}]"#;
    tokio::fs::write(tmp.path().join("threads.json"), v0_json)
        .await
        .unwrap();

    let mappings = ThreadManager::load_from_dir(tmp.path()).await.unwrap();
    assert_eq!(mappings.len(), 1);
    assert_eq!(mappings[0].thread_id, "old-t1");
}

// ---------------------------------------------------------------------------
// Recorder broadcast-channel coverage
// ---------------------------------------------------------------------------
// Verifies the real recorder path: notifications sent through event_tx are
// picked up by the background task and reflected in get_workspace_usage.
// Covers Blockers 1 (snapshot keyed by acp_session_id) and 2 (cost branch).

#[tokio::test]
async fn recorder_broadcast_channel_turn_and_cost_coverage() {
    use emergent_protocol::{Notification, ThreadTokenUsagePayload, TurnUsagePayload, WorkspaceId};
    use tempfile::TempDir;

    let tmp = TempDir::new().unwrap();
    let ws_id = WorkspaceId::from("it-ws-recorder");

    let (_, _tr, manager) = spawn_test_server().await;
    manager
        .thread_manager()
        .register_workspace_for_test(ws_id.clone(), tmp.path().to_path_buf())
        .await;

    // Register a synthetic live thread so the recorder can resolve acp_session_id.
    let thread_id = "rec-thread-1".to_string();
    let agent_id = "agent-rec".to_string();
    let session_id_1 = "acp-session-rec-1".to_string();
    manager
        .thread_manager()
        .register_live_thread_for_test(
            thread_id.clone(),
            agent_id.clone(),
            ws_id.clone(),
            Some(session_id_1.clone()),
        )
        .await;

    let tx = manager.thread_manager().event_sender();

    // ── Step 1: first TurnUsage (cumulative from session start) ──────────────
    let _ = tx.send(Notification::TurnUsage(TurnUsagePayload {
        thread_id: thread_id.clone(),
        workspace_id: ws_id.0.clone(),
        agent_definition_id: agent_id.clone(),
        input_tokens: 500,
        output_tokens: 100,
        cached_read_tokens: 0,
        cached_write_tokens: 0,
        thought_tokens: 0,
        total_tokens: 600,
        at: "2026-04-25T10:00:00Z".into(),
    }));

    // Give the background recorder task time to process.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let snap = manager.thread_manager().get_workspace_usage(&ws_id).await;
    assert_eq!(
        snap.agents.len(),
        1,
        "expected one agent entry after TurnUsage"
    );
    assert_eq!(snap.agents[0].input_tokens, 500);
    assert_eq!(snap.agents[0].output_tokens, 100);
    assert_eq!(snap.agents[0].total_tokens, 600);
    assert_eq!(snap.agents[0].turn_count, 1);

    // ── Step 2: TokenUsage with a cost amount ─────────────────────────────────
    let _ = tx.send(Notification::TokenUsage(ThreadTokenUsagePayload {
        thread_id: thread_id.clone(),
        used_tokens: 600,
        context_size: 8192,
        cost_amount: Some(0.012),
        cost_currency: Some("usd".into()),
    }));

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let snap = manager.thread_manager().get_workspace_usage(&ws_id).await;
    assert!(
        snap.agents[0].cost_amount > 0.0,
        "cost_amount must be non-zero after TokenUsage; got {}",
        snap.agents[0].cost_amount
    );

    // ── Step 3: second TurnUsage — cumulative higher (delta only applied) ─────
    let _ = tx.send(Notification::TurnUsage(TurnUsagePayload {
        thread_id: thread_id.clone(),
        workspace_id: ws_id.0.clone(),
        agent_definition_id: agent_id.clone(),
        input_tokens: 800,  // cumulative: 800 total → delta = 300
        output_tokens: 160, // cumulative: 160 total → delta = 60
        cached_read_tokens: 0,
        cached_write_tokens: 0,
        thought_tokens: 0,
        total_tokens: 960, // cumulative: 960 → delta = 360
        at: "2026-04-25T10:01:00Z".into(),
    }));

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let snap = manager.thread_manager().get_workspace_usage(&ws_id).await;
    // Total should be first turn (600) + second turn delta (360) = 960
    assert_eq!(
        snap.agents[0].total_tokens, 960,
        "total_tokens after two cumulative turns should be 960; got {}",
        snap.agents[0].total_tokens
    );
    assert_eq!(snap.agents[0].turn_count, 2);

    // ── Step 4: kill + new session — snapshot must reset ─────────────────────
    // Update the acp_session_id on the live handle to simulate a new session
    // (as would happen after kill_thread + a new spawn). Also clear snapshots
    // by calling kill_thread logic via the manager (which removes by acp_session_id).
    let session_id_2 = "acp-session-rec-2".to_string();
    manager
        .thread_manager()
        .set_acp_session_id_for_test(&thread_id, Some(session_id_2.clone()))
        .await;

    // Manually remove the old session snapshot so the new session starts fresh
    // (mirrors what kill_thread would do for the old session_id_1).
    manager
        .thread_manager()
        .clear_session_snapshot_for_test(&session_id_1)
        .await;

    // Send a TurnUsage for the new session: cumulative = 200 (fresh start).
    let _ = tx.send(Notification::TurnUsage(TurnUsagePayload {
        thread_id: thread_id.clone(),
        workspace_id: ws_id.0.clone(),
        agent_definition_id: agent_id.clone(),
        input_tokens: 200,
        output_tokens: 50,
        cached_read_tokens: 0,
        cached_write_tokens: 0,
        thought_tokens: 0,
        total_tokens: 250,
        at: "2026-04-25T10:02:00Z".into(),
    }));

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let snap = manager.thread_manager().get_workspace_usage(&ws_id).await;
    // The new session starts fresh: delta = 250 (not clamped to 0).
    // Grand total: 960 + 250 = 1210.
    assert_eq!(
        snap.agents[0].total_tokens, 1210,
        "new session delta should not be clamped; expected 1210, got {}",
        snap.agents[0].total_tokens
    );
    assert_eq!(snap.agents[0].turn_count, 3);
}

// ---------------------------------------------------------------------------
// is_echo field: UserMessagePayload wire-format and Notification roundtrip
// ---------------------------------------------------------------------------
// Verifies the contract that the frontend depends on:
//   - is_echo=true serialises and deserialises correctly
//   - is_echo=false likewise
//   - The Notification::UserMessage variant carries the field through the
//     broadcast channel (the path taken by handle_session_update)

#[tokio::test]
async fn user_message_payload_is_echo_roundtrips_through_notification() {
    use emergent_protocol::{Notification, UserMessagePayload};
    use tokio::sync::broadcast;

    // ── (a) Serialisation roundtrip for is_echo=true ─────────────────────────
    let echo_payload = UserMessagePayload {
        thread_id: "t-echo".into(),
        content: "hello".into(),
        is_echo: true,
    };
    let json = serde_json::to_string(&echo_payload).unwrap();
    assert!(
        json.contains("\"is_echo\":true"),
        "is_echo=true must appear in JSON; got: {}",
        json
    );
    let restored: UserMessagePayload = serde_json::from_str(&json).unwrap();
    assert!(restored.is_echo);

    // ── (b) Serialisation roundtrip for is_echo=false ────────────────────────
    let non_echo_payload = UserMessagePayload {
        thread_id: "t-spontaneous".into(),
        content: "spontaneous".into(),
        is_echo: false,
    };
    let json2 = serde_json::to_string(&non_echo_payload).unwrap();
    assert!(
        json2.contains("\"is_echo\":false"),
        "is_echo=false must appear in JSON; got: {}",
        json2
    );
    let restored2: UserMessagePayload = serde_json::from_str(&json2).unwrap();
    assert!(!restored2.is_echo);

    // ── (c) Full Notification roundtrip through broadcast channel ─────────────
    let (tx, mut rx) = broadcast::channel::<Notification>(8);

    let _ = tx.send(Notification::UserMessage(UserMessagePayload {
        thread_id: "t-echo".into(),
        content: "hello".into(),
        is_echo: true,
    }));
    let n = rx.try_recv().expect("notification sent");
    match n {
        Notification::UserMessage(p) => {
            assert_eq!(p.thread_id, "t-echo");
            assert!(
                p.is_echo,
                "is_echo must survive the broadcast channel roundtrip"
            );
        }
        _ => panic!("expected UserMessage notification"),
    }

    // ── (d) Non-echo notification through broadcast channel ───────────────────
    let _ = tx.send(Notification::UserMessage(UserMessagePayload {
        thread_id: "t-spontaneous".into(),
        content: "spontaneous".into(),
        is_echo: false,
    }));
    let n2 = rx.try_recv().expect("non-echo notification sent");
    match n2 {
        Notification::UserMessage(p) => {
            assert!(!p.is_echo, "spontaneous message must carry is_echo=false");
        }
        _ => panic!("expected UserMessage notification"),
    }
}

// ---------------------------------------------------------------------------
// shutdown_thread: dormant-demotion guard (init-cancel hygiene)
// ---------------------------------------------------------------------------
// A thread stopped before it obtained an ACP session (e.g. cancelled during the
// init handshake) must NOT leave a dormant stub behind — there is nothing to
// resume, so a stub would be a dead, un-resumable phantom. A thread WITH a
// session must still demote to dormant so it stays resumable.

#[tokio::test]
async fn shutdown_thread_skips_dormant_for_session_less_thread() {
    use emergent_protocol::WorkspaceId;

    let (_, _tr, manager) = spawn_test_server().await;
    let ws_id = WorkspaceId::from("it-ws-init-cancel");

    manager
        .thread_manager()
        .register_live_thread_for_test(
            "init-cancelled".into(),
            "agent-z".into(),
            ws_id.clone(),
            None, // no ACP session yet — mirrors a thread killed mid-handshake
        )
        .await;

    let ws = manager
        .thread_manager()
        .shutdown_thread("init-cancelled")
        .await
        .unwrap();
    assert_eq!(ws, Some(ws_id.clone()));

    // Gone from the live map.
    assert!(!manager.live_thread_ids().await.contains("init-cancelled"));
    // And NOT demoted to a dormant stub.
    let dormant = manager.thread_manager().dormant_snapshot().await;
    assert!(
        !dormant.contains_key("init-cancelled"),
        "a session-less thread must not leave a dormant stub: {:?}",
        dormant.keys().collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn shutdown_thread_demotes_thread_with_session() {
    use emergent_protocol::WorkspaceId;

    let (_, _tr, manager) = spawn_test_server().await;
    let ws_id = WorkspaceId::from("it-ws-resumable");

    manager
        .thread_manager()
        .register_live_thread_for_test(
            "has-session".into(),
            "agent-z".into(),
            ws_id.clone(),
            Some("acp-live".into()),
        )
        .await;

    manager
        .thread_manager()
        .shutdown_thread("has-session")
        .await
        .unwrap();

    assert!(!manager.live_thread_ids().await.contains("has-session"));
    let dormant = manager.thread_manager().dormant_snapshot().await;
    let stub = dormant
        .get("has-session")
        .expect("a thread with a session must demote to a resumable dormant stub");
    assert_eq!(stub.acp_session_id.as_deref(), Some("acp-live"));
}

// ===========================================================================
// Live mock-agent integration — spawn the real `mock-agent` binary over ACP as
// a local host process (no Docker), drive a turn, and assert the streamed
// response. This is the first test that exercises the full agent lifecycle:
// spawn -> ACP handshake -> prompt -> streamed message + tool call -> complete.
// ===========================================================================

/// Absolute path to the compiled `mock-agent` binary, derived from this test
/// runner's own location: `target/<profile>/deps/<test>` -> `target/<profile>/mock-agent`.
fn mock_agent_bin() -> std::path::PathBuf {
    let mut path = std::env::current_exe().expect("current_exe");
    path.pop(); // drop the test binary name -> .../deps
    if path.file_name().is_some_and(|n| n == "deps") {
        path.pop(); // -> target/<profile>
    }
    path.push(format!("mock-agent{}", std::env::consts::EXE_SUFFIX));
    path
}

/// Resolve the `mock-agent` binary, building it if a bare `cargo test -p
/// emergent-core` skipped it. `cargo test --workspace` (CI, `bun run test:rust`)
/// compiles every workspace member up front, so this fast-paths to the artifact.
fn ensure_mock_agent() -> std::path::PathBuf {
    let bin = mock_agent_bin();
    if !bin.exists() {
        // Build into the target dir this test was itself built into, rather than
        // the workspace default. Under `cargo llvm-cov` the two differ (it
        // redirects to `target/llvm-cov-target`), so a bare build would land the
        // artifact somewhere `mock_agent_bin` never looks.
        let target_dir = bin
            .parent()
            .and_then(|profile| profile.parent())
            .expect("mock-agent path has target/<profile>/ ancestors");
        let status = std::process::Command::new(env!("CARGO"))
            .args(["build", "-p", "mock-agent"])
            .arg("--target-dir")
            .arg(target_dir)
            .status()
            .expect("run `cargo build -p mock-agent`");
        assert!(status.success(), "`cargo build -p mock-agent` failed");
    }
    assert!(
        bin.exists(),
        "mock-agent binary not found at {} — run via `cargo test --workspace`",
        bin.display()
    );
    bin
}

/// Block until the ACP handshake completes for `thread_id` (a `SessionReady`
/// notification), or panic after `within`.
async fn wait_for_session_ready(
    rx: &mut broadcast::Receiver<Notification>,
    thread_id: &str,
    within: std::time::Duration,
) {
    tokio::time::timeout(within, async {
        loop {
            match rx.recv().await {
                Ok(Notification::SessionReady(p)) if p.thread_id == thread_id => return,
                Ok(_) => continue,
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => {
                    panic!("event channel closed before SessionReady")
                }
            }
        }
    })
    .await
    .expect("timed out waiting for SessionReady");
}

/// Collect this thread's notifications up to and including `PromptComplete`, or
/// panic after `within`. Other threads' events and `Lagged` gaps are skipped.
async fn collect_turn(
    rx: &mut broadcast::Receiver<Notification>,
    thread_id: &str,
    within: std::time::Duration,
) -> Vec<Notification> {
    tokio::time::timeout(within, async {
        let mut out = Vec::new();
        loop {
            match rx.recv().await {
                Ok(n) => {
                    let keep = match &n {
                        Notification::MessageChunk(p) => p.thread_id == thread_id,
                        Notification::ToolCallUpdate(p) => p.thread_id == thread_id,
                        Notification::StatusChange(p) => p.thread_id == thread_id,
                        Notification::PromptComplete(p) => p.thread_id == thread_id,
                        _ => false,
                    };
                    let done =
                        matches!(&n, Notification::PromptComplete(p) if p.thread_id == thread_id);
                    if keep {
                        out.push(n);
                    }
                    if done {
                        return out;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return out,
            }
        }
    })
    .await
    .expect("timed out waiting for PromptComplete")
}

/// Collect ALL notifications for `thread_id` (including TurnDispatched) until the
/// turn's PromptComplete. Unlike `collect_turn`, this does not filter by variant.
async fn collect_all_for_thread(
    rx: &mut broadcast::Receiver<Notification>,
    thread_id: &str,
    within: std::time::Duration,
) -> Vec<Notification> {
    tokio::time::timeout(within, async {
        let mut out = Vec::new();
        loop {
            match rx.recv().await {
                Ok(n) => {
                    if n.thread_id() == Some(thread_id) {
                        let done = matches!(&n, Notification::PromptComplete(_));
                        out.push(n);
                        if done {
                            return out;
                        }
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return out,
            }
        }
    })
    .await
    .expect("timed out waiting for PromptComplete")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn turn_dispatched_emitted_before_response_and_recorded() {
    use emergent_protocol::WorkspaceId;
    use std::time::Duration;
    use tempfile::TempDir;

    let mock_bin = ensure_mock_agent();
    let tmp = TempDir::new().unwrap();
    let ws_id = WorkspaceId::from("it-ws-turn-dispatched");

    let (_url, _registry, manager, event_tx) = spawn_test_server_with_events().await;
    manager
        .thread_manager()
        .register_workspace_for_test(ws_id.clone(), tmp.path().to_path_buf())
        .await;

    let cli = format!("'{}'", mock_bin.display());
    let agent_id = manager
        .create_agent_with_command(ws_id.clone(), "mock".into(), AgentProvider::Mock, cli)
        .await
        .expect("create_agent");

    let mut rx = event_tx.subscribe();
    let thread_id = manager.spawn_thread(&agent_id, None).await.expect("spawn_thread");
    wait_for_session_ready(&mut rx, &thread_id, Duration::from_secs(20)).await;

    // A single inbound inter-thread notification, no user text.
    manager
        .enqueue_message(
            &thread_id,
            emergent_core::agent::queue::MessageSource::Thread {
                from_thread_id: "b".into(),
                from_name: "Agent B".into(),
            },
            "ping from B".into(),
        )
        .await
        .expect("enqueue_message");

    let notifs = collect_all_for_thread(&mut rx, &thread_id, Duration::from_secs(20)).await;

    let td_idx = notifs
        .iter()
        .position(|n| matches!(n, Notification::TurnDispatched(_)))
        .expect("TurnDispatched emitted");
    let chunk_idx = notifs
        .iter()
        .position(|n| matches!(n, Notification::MessageChunk(_)))
        .expect("expected at least one MessageChunk in the turn");
    assert!(td_idx < chunk_idx, "TurnDispatched must precede the assistant response");
    match &notifs[td_idx] {
        Notification::TurnDispatched(p) => {
            assert_eq!(p.user_text, None);
            assert_eq!(p.notifications.len(), 1);
            assert_eq!(p.notifications[0].source, "thread");
            assert_eq!(p.notifications[0].from.as_deref(), Some("Agent B"));
            assert_eq!(p.notifications[0].content, "ping from B");
        }
        _ => unreachable!(),
    }

    let history = manager.thread_manager().get_history(&thread_id).await.unwrap();
    assert!(
        history.iter().any(|n| matches!(n, Notification::TurnDispatched(_))),
        "TurnDispatched must be recorded in history"
    );
}

/// The mock agent reports `load_session: false` and does not implement the
/// method, which is exactly the shape of a real agent that only supports fresh
/// sessions. Resuming against it must fall back to `session/new` and come up
/// usable, rather than surfacing a raw `method_not_found` and stranding the
/// thread the way an unconditional `session/load` did.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resume_falls_back_to_new_session_when_agent_lacks_load_capability() {
    use emergent_protocol::WorkspaceId;
    use std::time::Duration;
    use tempfile::TempDir;

    let mock_bin = ensure_mock_agent();
    let tmp = TempDir::new().unwrap();
    let ws_id = WorkspaceId::from("it-ws-resume-fallback");

    let (_url, _registry, manager, event_tx) = spawn_test_server_with_events().await;
    manager
        .thread_manager()
        .register_workspace_for_test(ws_id.clone(), tmp.path().to_path_buf())
        .await;

    let cli = format!("'{}'", mock_bin.display());
    let agent_id = manager
        .create_agent_with_command(ws_id.clone(), "mock".into(), AgentProvider::Mock, cli)
        .await
        .expect("create_agent");

    let mut rx = event_tx.subscribe();
    let thread_id = manager.spawn_thread(&agent_id, None).await.expect("spawn_thread");
    wait_for_session_ready(&mut rx, &thread_id, Duration::from_secs(20)).await;

    manager.shutdown_thread(&thread_id).await.expect("shutdown_thread");

    let mut rx2 = event_tx.subscribe();
    manager
        .resume_thread(&thread_id, &agent_id, "stale-session-id")
        .await
        .expect("resume must succeed by falling back to a new session");
    wait_for_session_ready(&mut rx2, &thread_id, Duration::from_secs(20)).await;

    // Falling back is only worth anything if the thread can actually take a turn.
    manager
        .enqueue_message(
            &thread_id,
            emergent_core::agent::queue::MessageSource::User,
            "hello".into(),
        )
        .await
        .expect("enqueue_message");

    let notifs = collect_all_for_thread(&mut rx2, &thread_id, Duration::from_secs(20)).await;
    assert!(
        notifs.iter().any(|n| matches!(n, Notification::MessageChunk(_))),
        "resumed thread must complete a turn, got: {:?}",
        notifs
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn mock_agent_use_tools_streams_tool_call_and_message() {
    use emergent_protocol::WorkspaceId;
    use std::time::Duration;
    use tempfile::TempDir;

    let mock_bin = ensure_mock_agent();
    let tmp = TempDir::new().unwrap();
    let ws_id = WorkspaceId::from("it-ws-mock-agent");

    let (_url, _registry, manager, event_tx) = spawn_test_server_with_events().await;
    manager
        .thread_manager()
        .register_workspace_for_test(ws_id.clone(), tmp.path().to_path_buf())
        .await;

    // The agent's CLI launches the mock-agent binary. Single-quote the path so
    // the shell-split in `parse_agent_command` keeps it as one argument even if
    // the temp/target path contains spaces.
    let cli = format!("'{}'", mock_bin.display());
    let agent_id = manager
        .create_agent_with_command(ws_id.clone(), "mock".into(), AgentProvider::Mock, cli)
        .await
        .expect("create_agent");

    // Subscribe BEFORE spawning so the one-shot SessionReady event isn't missed
    // (broadcast channels don't replay history to late subscribers).
    let mut rx = event_tx.subscribe();
    let thread_id = manager
        .spawn_thread(&agent_id, None)
        .await
        .expect("spawn_thread");

    wait_for_session_ready(&mut rx, &thread_id, Duration::from_secs(20)).await;

    // "use tools" makes the mock-agent emit a Read-file tool call (pending ->
    // completed) followed by a message, then end the turn.
    manager
        .enqueue_message(
            &thread_id,
            emergent_core::agent::queue::MessageSource::User,
            "use tools".into(),
        )
        .await
        .expect("enqueue_message");

    let notifs = collect_turn(&mut rx, &thread_id, Duration::from_secs(20)).await;

    // The tool call streamed through, titled and resolved to completed.
    let saw_title = notifs.iter().any(
        |n| matches!(n, Notification::ToolCallUpdate(p) if p.title.as_deref() == Some("Read file")),
    );
    assert!(
        saw_title,
        "expected a 'Read file' tool call; got {notifs:#?}"
    );

    let saw_completed = notifs.iter().any(|n| {
        matches!(n, Notification::ToolCallUpdate(p)
            if p.tool_call_id == "tc-001" && p.status.as_deref() == Some("completed"))
    });
    assert!(
        saw_completed,
        "expected tool call tc-001 to complete; got {notifs:#?}"
    );

    // The assistant message streamed through.
    let message: String = notifs
        .iter()
        .filter_map(|n| match n {
            Notification::MessageChunk(p) if p.kind == "message" => Some(p.content.as_str()),
            _ => None,
        })
        .collect();
    assert!(
        message.contains("I read the file successfully."),
        "expected the success message; got {message:?}"
    );

    // And the turn completed.
    assert!(
        notifs
            .iter()
            .any(|n| matches!(n, Notification::PromptComplete(_))),
        "expected a PromptComplete; got {notifs:#?}"
    );

    manager.kill_thread(&thread_id).await.expect("kill_thread");
}
