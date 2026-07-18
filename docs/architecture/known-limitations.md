# Known Limitations & Tech-Debt Tracker

A curated list of open design questions, behavioral edges, and vestigial code in Emergent. Each entry describes the **current behavior**, its **impact**, **why it exists**, and a **possible direction** — so a new engineer knows what is intentional, what is a footgun, and what is safe to change.

This is a living document. It complements the "unspecified / non-goal" notes scattered through the other architecture docs; if you find a new sharp edge, add it here rather than burying it in a code comment.

> **Scope note.** Items here are _known_ trade-offs and drift, not bugs with open tickets. Where the behavior is a deliberate simplification, that is called out. Where it is accidental drift (vestigial state, dropped fields), that is called out too.

Related reading: [Documentation Index](../README.md) · [System Overview](system-overview.md) · [Task & Swarm Coordination](task-and-swarm-coordination.md) · [Persistence & Usage](persistence-and-usage.md) · [MCP Server & Auth](mcp-server-and-auth.md) · [Agent Lifecycle & ACP](agent-lifecycle-and-acp.md) · [IPC & Events Reference](../reference/ipc-and-events.md)

---

## 1. Agents are local host processes — config isolation, not OS sandboxing

**Current behavior.** Every agent runs as a **local host process**, spawned via `LocalProcessSpawner` (`agent/lifecycle.rs`) with `HOME` pointed at the agent's own directory and an enriched `PATH`. There is no Docker, no container runtime, and no `bollard` dependency anywhere. Isolation is per-agent `$HOME`: each agent's `.claude` / `.codex` config lives under a private home. To keep OAuth working, the real macOS login Keychain and the Codex credential file are _symlinked into_ that private home (the `#[cfg(target_os = "macos")]` / `#[cfg(unix)]` blocks in `lifecycle.rs`). Terminals are host PTYs (`workspace/terminal.rs`), not `docker exec` sessions.

This is the current, intended design — the architecture docs, `README.md`, and `CLAUDE.md` all describe it as such.

**Impact.** "Isolation" here means _configuration_ isolation, not OS-level sandboxing. An agent runs with the user's own privileges and real credentials; a reader who assumes kernel-level sandboxing will be wrong. Combined with item #2 (auto-approved permissions), an agent can do anything the user can.

> **Invariant:** an agent process runs _as the current user_ with the user's real credentials symlinked in. It is isolated in terms of _config_ (a private `$HOME`), **not** in terms of OS privileges. The symlink comment in `lifecycle.rs` is explicit: "The agent already runs as the user, so this grants no access it couldn't otherwise obtain."

> **Why the loopback MCP server is safe:** because agents are local host processes, binding the MCP HTTP server to `127.0.0.1` (see [MCP Server & Auth](mcp-server-and-auth.md)) is sufficient network isolation. This argument would _not_ hold under a container model with its own network namespace.

> **Note:** the MCP tool surface is `create_task` / `list_tasks` / `list_agents` / `update_task` / `complete_task` (`mcp/handler.rs`) — those are the tools defined by the handler. Both `README.md` and `CLAUDE.md` document the local-process model and this tool set correctly (README advertises `list_agents` alongside `create_task` / `list_tasks` / `update_task` / `complete_task`). There is no `send_message` MCP tool (the name exists only as a mock-agent helper), and the only `list_peers` reference anywhere is a deliberately-bogus tool name in the auth-failure tests (`tests/integration.rs`).

**Possible direction.** If OS-level sandboxing ever becomes a goal, it would require a real container/sandbox backend and would invalidate the loopback-safety argument above — a substantial change, and a non-goal today.

---

## 2. ACP permission requests are auto-approved

**Current behavior.** When an agent asks the client for permission (an ACP `RequestPermissionRequest`), Emergent always grants it by selecting the **first offered option** — see `build_permission_response` in `acp_bridge.rs`:

```rust
let outcome = if let Some(first) = args.options.first() {
    RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(first.option_id.clone()))
} else {
    RequestPermissionOutcome::Cancelled
};
```

This handler is wired into the ACP client's `on_receive_request` callback in `lifecycle.rs`, and it responds immediately — there is no prompt to the user, no queue, no policy check.

There is no frontend surface for permission requests either: the `DisplayToolCall["status"]` union in `stores/types.ts` has no `permission` member, and the thread-level `ThreadProcessStatus` union omits it too.

**Impact.** Agents run effectively unattended: any tool the agent's CLI would gate behind a permission prompt is silently approved.

> **Gotcha:** "first option" is whatever the agent CLI lists first, which is conventionally the most-permissive "allow" choice — but Emergent does not inspect option semantics. If a future agent orders its options differently, auto-approve could pick an unexpected outcome. There is no allow-vs-deny (`option_kind`) discrimination.

> **Trade-off:** picking the first option buys a frictionless "agents just run" UX (essential for parallel/unattended swarms) at the cost of any human-in-the-loop safety gate.

**Possible direction.** Introduce an interactive permission flow: emit a `permission`-status notification, surface it via the already-built glyph, hold the ACP responder open until the user chooses, and add a per-agent "auto-approve" policy toggle. The frontend scaffolding (glyph, warning token) is deliberately in place for this.

---

## 3. Live cost is only reflected after a workspace reload

**Current behavior.** There are two distinct usage notifications:

- `thread:turn-usage` → `TurnUsagePayload` carries **token counts only** (input / output / cached / total) — no cost fields.
- `thread:token-usage` → `ThreadTokenUsagePayload` _does_ carry `cost_amount` / `cost_currency` (plus `used_tokens` / `context_size`).

The workspace usage aggregator `usageStore` (`stores/usage.svelte.ts`) subscribes **only to `thread:turn-usage`**; its `applyDelta` folds in tokens and never touches cost. Meanwhile the per-thread `agentStore.handleTokenUsage` (`stores/agents.svelte.ts`) _does_ receive `thread:token-usage`, but reads only `used_tokens` / `context_size` into `thread.tokenUsage`, **dropping the cost fields**.

Cost therefore only enters the UI through the persisted snapshot: `get_workspace_usage` returns totals whose `cost_amount` was folded in by the backend recorder, and `usageStore.loadForWorkspace` reads them on workspace switch/boot — so **live cost appears only after a reload**, while live token counts update continuously.

**Impact.** During an active session the per-agent cost figure is stale; it jumps to the correct value only when the user switches away and back (or restarts).

> **Why:** the delta-based live path (`turn-usage`) was designed around token accounting; cost accounting lives on the _other_ event (`token-usage`) that the aggregator doesn't listen to, and the per-thread listener that does hear it discards the cost fields.

**Possible direction.** Either add cost fields to `TurnUsagePayload` and fold them in `applyDelta`, or have `usageStore` additionally subscribe to `thread:token-usage` and apply its cost delta. Low-risk, self-contained frontend/protocol change.

---

## 4. The `recent_turns` ring buffer is persisted and returned but never consumed

**Current behavior.** `agent/usage_store.rs` maintains a per-workspace `recent_turns` ring buffer, capped at `RECENT_TURNS_CAP` (oldest evicted when full). It is serialized into `threads.json` and returned as part of `WorkspaceUsageStore` from `get_workspace_usage`.

The frontend never reads it. `WorkspaceUsageStorePayload` (`stores/usage.svelte.ts`) declares only an `agents` array — no `recent_turns` field — so the data is deserialized-away and ignored.

**Impact.** Every workspace's `threads.json` carries a capped buffer of turn records that nothing displays — extra write volume and disk footprint for no current benefit.

> **Trade-off:** keeping the buffer now means a future "usage timeline / per-turn history" UI would already have data to render; deleting it would shrink `threads.json` immediately.

**Possible direction.** Decide the intent: build the timeline UI that consumes `recent_turns`, or trim the field from the persisted schema and the `get_workspace_usage` result. If trimmed, bump the persistence schema version (see [Persistence & Usage](persistence-and-usage.md)).

---

## 5. Per-agent system prompts are frontend-only / in-memory

**Current behavior.** The UI lets you edit a per-agent system prompt, but it lives entirely in the frontend. `stores/app-state.svelte.ts` holds an `agentSystemPrompts` map, and `updateAgentSystemPrompt` only writes to it — its own comment: _"Display-only until `AgentDefinition` / `update_agent` gain a persisted system-prompt field."_

The backend `AgentDefinition` (`emergent-protocol`) has **no system-prompt field**, and neither `create_agent` nor `update_agent` accepts or stores one.

**Impact.** A system prompt typed in the UI is **lost on app restart**, and is never actually delivered to the agent (there is no backend plumbing to inject it into the ACP session). It is presentational state today.

> **Gotcha:** because it is in-memory only, two views of the "same" agent can briefly disagree if the frontend state is reset; and nothing prevents a user from believing a saved prompt is in effect when it is not.

**Possible direction.** Add a `system_prompt` field to `AgentDefinition`, thread it through `create_agent` / `update_agent` and `agents.json` persistence, and inject it into the ACP session (e.g. as part of, or alongside, the `<emergent-system>` block built in `swarm::build_system_block`). This is a schema change to `AgentDefinition` and its persisted form.

---

## 6. The task registry is a single global map keyed by short hex ids

**Current behavior.** `task/registry.rs` stores every task, across every workspace, in one `HashMap`. Ids come from `generate_id()` — 4 random bytes rendered as 8 hex chars (32 bits of entropy). Workspace isolation is achieved purely by _filtering_: `list_tasks`, `find_unblocked_tasks`, and `delete_tasks_for_workspace` all match on `workspace_id`.

**Impact.** A task-id collision (two tasks minting the same 8-hex id) would silently overwrite one task with another in the global map, potentially across workspaces. At 32 bits, collision probability is low for expected task volumes but is not zero (birthday-bound), and there is no explicit uniqueness guard on insert.

> **Trade-off:** short hex ids are user-friendly (readable in logs/UI) and a flat map is simple; the cost is global-namespace collision risk and reliance on filtering (rather than structure) for isolation. The same 8-hex scheme is used for workspace and thread ids — see [Persistence & Usage](persistence-and-usage.md) for the id-length inventory.

**Possible direction.** If task counts grow, either widen ids (UUIDs or more random bytes) or scope the map per workspace so ids only need to be unique within a workspace. Add a collision check on insert as a cheap interim guard.

---

## 7. Legacy "daemon" IPC stubs remain (embedded model is canonical)

**Current behavior.** Emergent has no separate daemon — the backend is embedded directly in the Tauri app ([System Overview](system-overview.md)). Two IPC handlers survive from an earlier separate-process design and are now stubs:

- `get_daemon_status` unconditionally returns `"connected"`. It reflects nothing about the system.
- `known_agents(workspace_id)` ignores its argument. Agent availability is host-wide (`detect::known_agents_on_host()`); the parameter is kept only to satisfy the IPC contract the frontend calls with.

**Impact.** These are honeypots for confusion: a reader might infer there is a daemon to health-check, or that `known_agents` is workspace-scoped. Neither is true.

> **Why:** they preserve the frontend's existing `invoke` call sites without a coordinated frontend change. Removing them would require touching the callers.

**Possible direction.** Treat the embedded-in-Tauri model as canonical (this doc set does). Either delete `get_daemon_status` and drop the unused `workspace_id` param from `known_agents` (coordinated with the frontend), or leave them as documented legacy stubs. See the legacy-stub notes in the [IPC & Events Reference](../reference/ipc-and-events.md).

---

## 8. A failed blocker permanently stalls its dependents

**Current behavior.** Task dependencies are enforced by `find_unblocked_tasks` (`task/registry.rs`), which returns a pending task only when **every** blocker is `is_completed()`:

```rust
.filter(|t| &t.workspace_id == workspace_id && t.state.is_pending())
.filter(|t| t.blocker_ids.iter().all(|bid| self.tasks.get(bid).is_some_and(|b| b.state.is_completed())))
```

`start_unblocked_tasks` (`task/mod.rs`) drives startup off this. A blocker that ends in `TaskState::Failed` is never `is_completed()`, so any task depending on it stays `Pending` forever. The task manager fails tasks on session/thread failure and on lag/startup reconciliation (`handle_session_failure`, `reconcile_after_lag`, `recover_stale_tasks`) — but there is no path that propagates failure _transitively down the dependency graph_.

**Impact.** One failed upstream task silently strands an arbitrarily large subtree of downstream tasks in `Pending`. They never start and never fail — they just wait indefinitely, with no user-visible error explaining why.

> **Invariant (intended):** a task starts only when _all_ its blockers completed successfully. That is correct for the success path; the gap is the _failure_ path having no counterpart.

> **Gotcha:** because dependents remain `Pending` (not `Failed`), UI that only surfaces failures won't flag the stall. It looks like nothing is happening.

**Possible direction.** Add failure propagation: when a task transitions to `Failed`, cascade a terminal state (a `Failed`, or a new `Blocked` / `Skipped`) to all tasks that transitively depend on it, with a reason referencing the failed blocker. This makes the stall visible and terminable.

---

## See also

- [Documentation Index](../README.md) — full docs map and reading order.
- [Task & Swarm Coordination](task-and-swarm-coordination.md) — the task lifecycle, blocker semantics, and the MCP task tools as the coordination channel (items #6, #8).
- [Persistence & Usage](persistence-and-usage.md) — what is and isn't persisted, id lengths, and the usage-recorder pipeline (items #3, #4, #6).
- [MCP Server & Auth](mcp-server-and-auth.md) — the loopback + bearer-token model whose safety depends on the local-process design (items #1, #2).
- [Agent Lifecycle & ACP](agent-lifecycle-and-acp.md) — `LocalProcessSpawner`, `$HOME` isolation, credential symlinks, and the permission callback (items #1, #2).
- [IPC & Events Reference](../reference/ipc-and-events.md) — the command/event catalog, including the legacy stubs (item #7).
  </content>
  </invoke>
