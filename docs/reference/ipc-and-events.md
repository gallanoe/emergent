# IPC Commands & Tauri Events Reference

A conceptual map of the two directions of frontend↔backend communication in Emergent: **request/response IPC commands** (Svelte `invoke()` → Rust `#[tauri::command]`) and **push events** (Rust `emit()` → Svelte `listen()`). This is a reference _map_, not an exhaustive catalog — the authoritative lists live in source (see [Where the full lists live](#where-the-full-lists-live)).

> **Framing:** Agents run as **local host processes**, not containers. The backend is **embedded in the Tauri app** — there is no daemon. Command handlers dispatch directly into the in-process `AgentManager`, `WorkspaceManager`, and `TaskManager` held as Tauri managed `State`. Anything named after a daemon or per-workspace agent detection is a legacy stub (see [Legacy stubs](#legacy-stubs)).

See also: [system-overview](../architecture/system-overview.md) · [notifications-and-protocol](../architecture/notifications-and-protocol.md) · [runtime-lifecycle](../architecture/runtime-lifecycle.md) · [frontend-architecture](../frontend/frontend-architecture.md) · [docs index](../README.md)

---

## How the two directions work

```
Frontend                         Tauri app (src-tauri)                 Core managers
────────                         ─────────────────────                 ─────────────
invoke("send_prompt", {...})  ─▶ #[tauri::command] send_prompt(..)  ─▶ AgentManager::queue_prompt
        (Promise resolves) ◀────  Result<T,String> serialized      ◀── (oneshot reply)

listen("thread:message-chunk") ◀─ bridge_handle.emit(name, payload) ◀── Notification broadcast(1024)
```

- **Commands** are `async fn`s tagged `#[tauri::command]`, registered in the `generate_handler!` block in `lib.rs`. Managers are injected via `State<'_, Arc<...>>`; the frontend never passes them.
- **Invariant — every command returns `Result<T, String>`.** The `Err(String)` becomes a rejected JS Promise. This uniform shape is what makes the frontend's **optimistic-update + rollback** pattern work: the store mutates UI state immediately, `await`s the command, and reverts on rejection (see `setConfig` in `agents.svelte.ts`). Commands that mutate remote state return the _authoritative_ post-change value (e.g. `set_thread_config` returns the updated option set) so the optimistic guess can be reconciled.
- **Events** originate as `Notification` enum variants (`emergent-protocol` `types.rs`) published on a `tokio::sync::broadcast::channel::<Notification>(1024)`. A bridge task in `lib.rs` re-emits **only the inner payload** under the channel name from `Notification::event_name()`. Terminal events take a separate path (see [Terminal events bypass the broadcast](#terminal-events-bypass-the-broadcast)).

**Gotcha (naming asymmetry):** Tauri auto-converts _command names and arguments_ between JS `camelCase` and Rust `snake_case` — the frontend calls `invoke("send_prompt", { threadId })` for a fn taking `thread_id`. But event _payload_ fields are serialized as-is; almost every payload struct is plain `snake_case` (no `rename_all`), so listeners read `thread_id`, `used_tokens`, etc. **The exception is `ToolCallContentPayload`** (`#[serde(tag = "type", rename_all = "camelCase")]`): because `rename_all` on an enum renames only the _variant tags_, a diff item serializes as `{"type":"diff", ...}` (camelCased tag) but keeps **snake_case fields inside** (`old_text`, `new_text`, `terminal_id`, `exit_code`). See [notifications-and-protocol](../architecture/notifications-and-protocol.md#31-the-wire-asymmetry-read-this-twice).

---

## Command categories

Commands group by the manager they dispatch into. Each category is a thin pass-through _except_ where a handler enforces a cross-manager invariant (see [Cross-manager guards](#cross-manager-guards)).

- **Agent-definition CRUD** (`AgentManager`) — create/read/update/delete/list `AgentDefinition`s. A definition is a _template_ for spawning threads, not a running process. Also lists an agent's threads and its persisted `ThreadMapping` records (thread id ↔ definition ↔ ACP session), which are what make a dormant thread resumable — a mapping without an `acp_session_id` is not.
- **Thread lifecycle** (`AgentManager`) — spawn a fresh local agent process/session, resume a dormant one onto its prior ACP session, send/cancel a prompt turn, kill (hard) or shutdown (graceful, used on exit) the process, delete the thread and its mapping, and get/set the ACP session config. `get_history` and `send_prompt` carry design weight — see below.
- **Swarm / coordination** (`AgentManager`) — toggle a thread's management permissions. Actual inter-agent coordination happens through the MCP task tools, not through this IPC surface; see [task-and-swarm-coordination](../architecture/task-and-swarm-coordination.md).
- **Workspace** (`WorkspaceManager`) — create/rename/get/list/delete workspaces. `list_workspaces` also reaches into `AgentManager` to fold live thread counts into each summary; `delete_workspace` cascades across managers (see below).
- **Terminal** (`WorkspaceManager`) — open a host PTY rooted at the workspace path, write keystrokes, resize, close. Terminal _output_ never returns as a command result — it arrives out-of-band on `terminal:*` events (see below). See [workspaces-and-terminals](../architecture/workspaces-and-terminals.md).
- **Usage** (`AgentManager`) — aggregated token/cost totals for the dashboard; live deltas arrive via `thread:turn-usage` / `thread:token-usage`. See [persistence-and-usage](../architecture/persistence-and-usage.md).
- **Tasks** (`TaskManager`) — create a task, list per-workspace or per-agent, get one. Tauri-initiated tasks pass `None` for `creator_thread_id` and `subscribe` — those fields exist for _agent_-initiated tasks created through the MCP tools (`create_task` / `list_tasks` / `list_agents` / `update_task` / `complete_task`), a separate agent-facing surface that shares names with these IPC commands but is not the same code path. See [task-and-swarm-coordination](../architecture/task-and-swarm-coordination.md).

---

## Cross-manager guards

Most handlers are thin, but a few encode **invariants that span managers** — the command layer is where multi-manager consistency is enforced, because no single manager owns the whole picture.

### `delete_agent` — active-task guard

- **Invariant:** an agent definition with an active (`Pending` or `Working`) task cannot be deleted; `Completed`/`Failed` tasks do not block it. "Active" is `TaskState::is_active()` in `emergent-protocol` `task.rs`.
- **Why:** deleting the agent would orphan a task that can never make progress.
- **Gotcha:** the check and the delete are two separate `await`s — not atomic. A task transitioning to Working in that window is a theoretical TOCTOU, tolerated in practice.

### `delete_workspace` — cascade

- **Order (matters):** kill running threads → delete the task graph → remove the workspace. The `?` on the kill step aborts the cascade if kills fail; the later steps proceed once kills succeed. Threads must die before their tasks/workspace so no orphaned agent process or task file survives.
- **Trade-off:** unlike `delete_agent`, this does **not** refuse when work is in flight — deletion is destructive by design, so callers should confirm in the UI.

### `send_prompt` — synchronous over a oneshot

- **Behavior:** the handler enqueues the prompt (`queue_prompt` returns a `oneshot::Receiver`) then `await`s that receiver, so the **IPC Promise resolves only when the entire prompt turn finishes** — or with `Err("Agent prompt loop terminated")` if the loop dies first.
- **Why:** gives the frontend one awaitable "turn done / turn failed" signal while incremental content streams over `thread:*` events. The Promise is the turn _boundary_; the events are the _content_.
- **Gotcha:** `send_prompt` can be a **long-lived** IPC call (a turn may run minutes) — do not treat it as a quick RPC. `cancel_prompt` interrupts an in-flight turn; the pending `send_prompt` then resolves through its normal completion path.

---

## Event channels

Push events are `Notification` variants on the `broadcast(1024)` channel; the bridge in `lib.rs` emits `(event_name, &payload)`. **The channel name is the discriminator** — the enum `type` tag is stripped, so listeners receive a bare payload struct. Channels are namespaced by concern:

- **`thread:*`** — the bulk of the traffic: streamed message/thinking chunks, tool-call updates, prompt completion, status changes, config updates, echoed user messages, errors, swarm nudges, system messages, session-ready (carries the `acp_session_id` that enables resume), and the two usage streams. Each carries a `thread_id`.
- **`agent:*`** — definition created/deleted (dashboard/list refresh); not thread-scoped.
- **`task:*`** — task created/updated (`{task: Task}`), plus `task:status-notification`, which is routed to the _creating_ thread via `creator_thread_id`.
- **`terminal:*`** — PTY output/exit; delivered out-of-band (see below), not thread-scoped.

Which variants carry a `thread_id` (and how `task:status-notification` maps through `creator_thread_id`) is encoded in `Notification::thread_id()`; the frontend uses it to route each event to the right thread's store.

### Terminal events bypass the broadcast

`terminal:output` / `terminal:exited` are **explicit no-op arms** in the notification bridge. They are emitted directly to the webview by `TauriTerminalSink` (`lib.rs`), which implements `TerminalEventSink`, **not** through the `broadcast(1024)` channel.

- **Why:** the shared broadcast is bounded and _evicts_ the oldest events for lagging receivers. Routing PTY floods around it means a noisy terminal can't drop unrelated agent notifications. The sink's `emit` is non-blocking and lossless.
- **Gotcha:** grepping the bridge `match` for terminal handling finds only `{}`; the real emit lives in `TauriTerminalSink`. The `TerminalOutput` / `TerminalExited` variants exist only to keep the enum and match exhaustive.
- **Trade-off:** the sink is fire-and-forget with no webview backpressure, so sustained high-rate output can grow the webview event queue unbounded. Bounding it is a tracked hardening follow-up.

### Bridge resilience

The bridge loop treats a slow consumer as non-fatal: `RecvError::Lagged(n)` is logged and the loop continues; `Closed` breaks it. **Invariant:** dropped notifications never crash the bridge — but they are genuinely lost for the frontend, so **UI state must be reconcilable from `get_history` / list commands, not assumed complete from the live stream.**

### `get_history` is the one tagged-wire exception

Live events are tag-stripped payloads. `get_history` returns `Vec<Notification>` serialized in full internally-tagged form (`{"type": "thread:message-chunk", ...}`), and the frontend replay path decodes that tagged union separately from its per-channel `listen()` handlers. See [notifications-and-protocol](../architecture/notifications-and-protocol.md#61-the-replay-path).

---

---

## Where the full lists live

This doc deliberately does **not** hand-mirror every command and event — those drift. The authoritative, exhaustive sources are:

- **Commands:** the handler definitions in `src-tauri/src/commands.rs` and the `generate_handler!` registration block in `src-tauri/src/lib.rs`. (Registration order has no runtime significance.)
- **Events:** the `Notification` enum plus its `event_name()` / `thread_id()` impls in `emergent-protocol` (`types.rs`), and the payload structs alongside them.

Consult the source for exact signatures, argument types, and payload fields.

---

## Related docs

- [system-overview](../architecture/system-overview.md) — the embedded, no-daemon, local-process architecture.
- [notifications-and-protocol](../architecture/notifications-and-protocol.md) — payload field definitions, tagged-vs-stripped wire format, history replay.
- [agent-lifecycle-and-acp](../architecture/agent-lifecycle-and-acp.md) — what `spawn_thread` / `resume_thread` / `send_prompt` drive underneath.
- [workspaces-and-terminals](../architecture/workspaces-and-terminals.md) — the terminal command/event pair and the sink.
- [task-and-swarm-coordination](../architecture/task-and-swarm-coordination.md) — task and swarm command semantics.
- [runtime-lifecycle](../architecture/runtime-lifecycle.md) — startup registration and shutdown of these handlers.
- [frontend-architecture](../frontend/frontend-architecture.md) — how the Svelte stores `invoke()` and `listen()`.
- [docs index](../README.md)
