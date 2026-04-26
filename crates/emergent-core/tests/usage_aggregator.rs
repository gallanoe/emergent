use emergent_core::agent::usage_store::{
    apply_turn_delta, PersistedWorkspaceState, TurnDelta, WorkspaceUsageStore, RECENT_TURNS_CAP,
};
use emergent_core::agent::thread_manager::ThreadMapping;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

fn delta(input: u64, output: u64, total: u64) -> TurnDelta {
    TurnDelta {
        input_tokens: input,
        output_tokens: output,
        total_tokens: total,
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn accumulates_delta_across_two_sessions() {
    let mut store = WorkspaceUsageStore::default();

    apply_turn_delta(&mut store, "agent-a", &delta(100, 50, 150), "2026-04-25T00:00:00Z");
    apply_turn_delta(&mut store, "agent-a", &delta(200, 80, 280), "2026-04-25T00:01:00Z");

    let entry = store.agents.iter().find(|a| a.agent_definition_id == "agent-a").unwrap();
    assert_eq!(entry.input_tokens, 300);
    assert_eq!(entry.output_tokens, 130);
    assert_eq!(entry.total_tokens, 430);
    assert_eq!(entry.turn_count, 2);
    assert_eq!(entry.last_turn_at.as_deref(), Some("2026-04-25T00:01:00Z"));
}

#[test]
fn multiple_agents_tracked_independently() {
    let mut store = WorkspaceUsageStore::default();

    apply_turn_delta(&mut store, "agent-x", &delta(500, 100, 600), "2026-04-25T00:00:00Z");
    apply_turn_delta(&mut store, "agent-y", &delta(200, 50, 250), "2026-04-25T00:00:00Z");

    assert_eq!(store.agents.len(), 2);
    let x = store.agents.iter().find(|a| a.agent_definition_id == "agent-x").unwrap();
    assert_eq!(x.total_tokens, 600);
    let y = store.agents.iter().find(|a| a.agent_definition_id == "agent-y").unwrap();
    assert_eq!(y.total_tokens, 250);
}

#[test]
fn ring_buffer_evicts_oldest_at_cap() {
    let mut store = WorkspaceUsageStore::default();

    // Fill buffer to cap
    for i in 0..RECENT_TURNS_CAP {
        let ts = format!("2026-04-25T00:{:02}:00Z", i % 60);
        apply_turn_delta(&mut store, "agent-a", &delta(1, 1, 2), &ts);
    }
    assert_eq!(store.recent_turns.len(), RECENT_TURNS_CAP);

    // One more should evict the oldest (index 0)
    apply_turn_delta(&mut store, "agent-a", &delta(999, 1, 1000), "2026-04-25T99:00:00Z");
    assert_eq!(store.recent_turns.len(), RECENT_TURNS_CAP);

    // The last entry should be the one we just pushed
    let last = store.recent_turns.last().unwrap();
    assert_eq!(last.input_tokens, 999);
}

#[test]
fn json_roundtrip_workspace_usage_store() {
    let mut store = WorkspaceUsageStore::default();
    apply_turn_delta(&mut store, "agent-a", &delta(1200, 280, 1480), "2026-04-25T10:34:00Z");

    let json = serde_json::to_string(&store).unwrap();
    let restored: WorkspaceUsageStore = serde_json::from_str(&json).unwrap();

    assert_eq!(restored.agents.len(), 1);
    let entry = &restored.agents[0];
    assert_eq!(entry.agent_definition_id, "agent-a");
    assert_eq!(entry.input_tokens, 1200);
    assert_eq!(entry.output_tokens, 280);
    assert_eq!(entry.total_tokens, 1480);
    assert_eq!(restored.recent_turns.len(), 1);
}

#[test]
fn v0_bare_array_parses_to_empty_usage() {
    // v0 threads.json is a bare JSON array — no `usage` field.
    let raw = r#"[{"thread_id":"t1","agent_definition_id":"a1","acp_session_id":null,"task_id":null}]"#;

    // Simulates the two-attempt parse in load_full_state_from_dir:
    // try PersistedWorkspaceState first (fails), then Vec<ThreadMapping>.
    let result = serde_json::from_str::<PersistedWorkspaceState>(raw);
    assert!(result.is_err(), "Should fail on bare array");

    let threads: Vec<ThreadMapping> = serde_json::from_str(raw).unwrap();
    let state = PersistedWorkspaceState {
        schema_version: 0,
        threads,
        usage: WorkspaceUsageStore::default(),
    };

    assert_eq!(state.threads.len(), 1);
    assert_eq!(state.threads[0].thread_id, "t1");
    assert!(state.usage.agents.is_empty());
}

#[test]
fn v1_envelope_parses_correctly() {
    let raw = serde_json::json!({
        "schema_version": 1,
        "threads": [
            {"thread_id": "t1", "agent_definition_id": "a1", "acp_session_id": null, "task_id": null}
        ],
        "usage": {
            "agents": [{
                "agent_definition_id": "a1",
                "input_tokens": 1200,
                "output_tokens": 280,
                "total_tokens": 1480,
                "turn_count": 1,
                "last_turn_at": "2026-04-25T10:34:00Z"
            }],
            "recent_turns": []
        }
    })
    .to_string();

    let state: PersistedWorkspaceState = serde_json::from_str(&raw).unwrap();
    assert_eq!(state.schema_version, 1);
    assert_eq!(state.threads.len(), 1);
    assert_eq!(state.usage.agents.len(), 1);
    assert_eq!(state.usage.agents[0].input_tokens, 1200);
}
