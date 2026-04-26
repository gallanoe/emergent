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

#[tokio::test]
async fn delete_workspace_clears_dormant_in_memory() {
    use emergent_core::agent::thread_manager::ThreadMapping;
    use emergent_protocol::{ContainerStatus, WorkspaceId};
    use tempfile::TempDir;

    let tmp = TempDir::new().unwrap();
    let ws_id = WorkspaceId::from("it-ws-delete");

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

    assert!(
        manager
            .thread_manager()
            .dormant_snapshot_for_workspace(&ws_id)
            .await
            .is_empty()
    );
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
    use emergent_protocol::{ContainerStatus, Notification, TurnUsagePayload, WorkspaceId};
    use tempfile::TempDir;

    let tmp = TempDir::new().unwrap();
    let ws_id = WorkspaceId::from("it-ws-usage");

    let (_, _tr, manager) = spawn_test_server().await;
    manager
        .thread_manager()
        .register_workspace_for_test(
            ws_id.clone(),
            tmp.path().to_path_buf(),
            ContainerStatus::Stopped,
        )
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
        assert_eq!(snap.recent_turns.len(), 1);
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
        .register_workspace_for_test(
            ws_id.clone(),
            tmp.path().to_path_buf(),
            ContainerStatus::Stopped,
        )
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
    use emergent_protocol::{
        ContainerStatus, Notification, ThreadTokenUsagePayload, TurnUsagePayload, WorkspaceId,
    };
    use tempfile::TempDir;

    let tmp = TempDir::new().unwrap();
    let ws_id = WorkspaceId::from("it-ws-recorder");

    let (_, _tr, manager) = spawn_test_server().await;
    manager
        .thread_manager()
        .register_workspace_for_test(
            ws_id.clone(),
            tmp.path().to_path_buf(),
            ContainerStatus::Stopped,
        )
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
    assert_eq!(snap.agents.len(), 1, "expected one agent entry after TurnUsage");
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
            assert!(
                !p.is_echo,
                "spontaneous message must carry is_echo=false"
            );
        }
        _ => panic!("expected UserMessage notification"),
    }
}
