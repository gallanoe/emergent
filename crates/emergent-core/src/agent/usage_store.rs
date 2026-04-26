use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

pub const RECENT_TURNS_CAP: usize = 1000;

// ---------------------------------------------------------------------------
// Persisted workspace envelope (threads.json v1)
// ---------------------------------------------------------------------------

fn default_schema_version() -> u32 {
    1
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct PersistedWorkspaceState {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub threads: Vec<super::thread_manager::ThreadMapping>,
    #[serde(default)]
    pub usage: WorkspaceUsageStore,
}

// ---------------------------------------------------------------------------
// Per-agent usage totals
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct AgentUsageTotals {
    pub agent_definition_id: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cached_read_tokens: u64,
    #[serde(default)]
    pub cached_write_tokens: u64,
    #[serde(default)]
    pub thought_tokens: u64,
    pub total_tokens: u64,
    pub turn_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_turn_at: Option<String>,
    #[serde(default)]
    pub cost_amount: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_currency: Option<String>,
}

// ---------------------------------------------------------------------------
// Individual turn event (ring buffer entry)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TurnEvent {
    pub agent_definition_id: String,
    pub at: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cached_read_tokens: u64,
    #[serde(default)]
    pub cached_write_tokens: u64,
    #[serde(default)]
    pub thought_tokens: u64,
    pub total_tokens: u64,
}

// ---------------------------------------------------------------------------
// Workspace-level store
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct WorkspaceUsageStore {
    pub agents: Vec<AgentUsageTotals>,
    /// Ring buffer capped at RECENT_TURNS_CAP. Oldest entry evicted when full.
    pub recent_turns: Vec<TurnEvent>,
}

// ---------------------------------------------------------------------------
// Delta accumulation helper
// ---------------------------------------------------------------------------

/// Additive increment for one turn (after double-count correction).
#[derive(Clone, Debug, Default)]
pub struct TurnDelta {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cached_read_tokens: u64,
    pub cached_write_tokens: u64,
    pub thought_tokens: u64,
    pub total_tokens: u64,
}

/// Apply a cost delta to `store` for `agent_id`.
/// Upserts the agent totals entry (creates one if absent) and adds `cost_delta`
/// to the running total. `currency` is only written the first time (or when
/// the previous entry had no currency set).
pub fn apply_cost_delta(
    store: &mut WorkspaceUsageStore,
    agent_id: &str,
    cost_delta: f64,
    currency: &str,
) {
    let entry = match store
        .agents
        .iter_mut()
        .find(|a| a.agent_definition_id == agent_id)
    {
        Some(e) => e,
        None => {
            store.agents.push(AgentUsageTotals {
                agent_definition_id: agent_id.to_string(),
                ..Default::default()
            });
            store.agents.last_mut().unwrap()
        }
    };

    entry.cost_amount += cost_delta;
    if entry.cost_currency.is_none() && !currency.is_empty() {
        entry.cost_currency = Some(currency.to_string());
    }
}

/// Apply a delta to `store` for `agent_id` at timestamp `at`.
/// Upserts the agent totals entry and pushes to the ring buffer.
pub fn apply_turn_delta(
    store: &mut WorkspaceUsageStore,
    agent_id: &str,
    delta: &TurnDelta,
    at: &str,
) {
    // Upsert agent totals
    let entry = match store
        .agents
        .iter_mut()
        .find(|a| a.agent_definition_id == agent_id)
    {
        Some(e) => e,
        None => {
            store.agents.push(AgentUsageTotals {
                agent_definition_id: agent_id.to_string(),
                ..Default::default()
            });
            store.agents.last_mut().unwrap()
        }
    };

    entry.input_tokens += delta.input_tokens;
    entry.output_tokens += delta.output_tokens;
    entry.cached_read_tokens += delta.cached_read_tokens;
    entry.cached_write_tokens += delta.cached_write_tokens;
    entry.thought_tokens += delta.thought_tokens;
    entry.total_tokens += delta.total_tokens;
    entry.turn_count += 1;
    entry.last_turn_at = Some(at.to_string());

    // Ring buffer: evict oldest when at cap
    if store.recent_turns.len() >= RECENT_TURNS_CAP {
        store.recent_turns.remove(0);
    }
    store.recent_turns.push(TurnEvent {
        agent_definition_id: agent_id.to_string(),
        at: at.to_string(),
        input_tokens: delta.input_tokens,
        output_tokens: delta.output_tokens,
        cached_read_tokens: delta.cached_read_tokens,
        cached_write_tokens: delta.cached_write_tokens,
        thought_tokens: delta.thought_tokens,
        total_tokens: delta.total_tokens,
    });
}
