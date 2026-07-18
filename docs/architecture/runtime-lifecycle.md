# Application Lifecycle: Boot, Recovery, Shutdown

How Emergent starts up, rehydrates persisted state after a restart, hands off to
the Svelte frontend, and tears itself down cleanly. The code (`run` in
`src-tauri/src/lib.rs`, `setupAfterConnect` in `app-state.svelte.ts`) tells you
_what_ happens step by step; this doc explains _why the sequence is ordered the
way it is_ and what breaks if you reorder it.

> **Architecture note (canonical):** Emergent runs each agent as a **local host
> process**, not in a Docker container. There is no separate daemon — the whole
> backend (`AgentManager`, `WorkspaceManager`, `TaskManager`, the MCP HTTP
> server) is embedded in the Tauri app and constructed inside the setup closure.
> A few code comments still say "container"; read that as "workspace directory /
> local process."

See also: [Documentation index](../README.md) ·
[System overview](./system-overview.md) ·
[Agent lifecycle & ACP](./agent-lifecycle-and-acp.md) ·
[MCP server & auth](./mcp-server-and-auth.md) ·
[Tasks & swarm coordination](./task-and-swarm-coordination.md) ·
[Persistence & usage](./persistence-and-usage.md) ·
[IPC & events reference](../reference/ipc-and-events.md)

---

## 1. The boot sequence

`main.rs` just calls `run()`. Everything of interest is in the synchronous
`.setup` closure Tauri runs once before its event loop. The order below is
**load-bearing** — the invariants in §6 are what enforce it.

```
main() ──► run()  .setup closure  (runs on the Tokio runtime via _rt_guard)
   1. broadcast::channel::<Notification>(1024)     → event_tx
   2. new_shared_state()                           → workspace_state
   3. TauriTerminalSink over AppHandle             → terminal_sink
   4. WorkspaceManager::new + load_workspaces()    (fault-isolated per entry)
   5. TokenRegistry::new()
   6. AgentManager::new           (spawns the recorder task → subscribes)
   7. TaskManager::new + start_event_loop(subscribe())
   8. mcp::http_server::start ──► set_mcp_port(port)   ⚠ BEFORE task resume
   9. RECOVERY: per-workspace load → recover_stale_tasks → resume_workspace_tasks
  10. app.manage(managers) · tray::setup_tray · notification-bridge task
             │
             ▼  app.run(RunEvent loop)  ── see §5 (shutdown)
```

**Why the runtime guard is held.** The setup closure is synchronous but every
manager constructor and the entire recovery pass are `async`. Entering the
runtime handle (bound to `_rt_guard`, held for the whole closure) lets the
closure `block_on` the bootstrap work and lets the three long-lived background
tasks — the recorder, the TaskManager event loop, and the notification bridge —
attach to that same runtime.

> **Gotcha:** the guard must bind to a named `_rt_guard`, not `_`. A bare `_`
> drops it immediately, and the later `spawn`/`block_on` calls panic with "no
> reactor running."

**Why the channel comes first.** A single bounded `tokio::broadcast` channel
(`event_tx`) is the backbone of the notification system. Every emitter and
subscriber needs a clone, so it is created before any manager. Boundedness
matters: broadcast is fan-out (recorder, TaskManager loop, frontend bridge all
subscribe), and a bound means a slow subscriber gets `RecvError::Lagged`
(drop + recover) instead of unbounded memory growth. Every subscriber treats
`Lagged` as recoverable, never fatal. See
[Notifications & protocol](./notifications-and-protocol.md).

> **Gotcha:** the channel's initial receiver is dropped, so sends before the
> first `subscribe()` return an error — intentionally. Pre-subscriber sends are
> discarded by design.

**Why terminal output bypasses the channel.** `TauriTerminalSink` implements
`TerminalEventSink` and emits `terminal:output` / `terminal:exited` straight to
the webview via `AppHandle::emit`, injected into `WorkspaceManager`.

> **Trade-off:** PTY output deliberately skips the bounded broadcast — a
> flooding shell would otherwise lag it and make the bridge drop _agent_
> notifications. The cost: `emit` is fire-and-forget with no backpressure, so
> sustained output can grow the webview queue unboundedly (a tracked hardening
> follow-up; in practice the user interrupts the command). The bridge's terminal
> match arms are explicit no-ops to avoid a doubled emit path. See
> [Workspaces & terminals](./workspaces-and-terminals.md).

> **Invariant:** the recorder task (spawned inside `AgentManager::new`) and the
> TaskManager event loop both `subscribe()` **before** the MCP server starts and
> recovery runs. If either subscribed later, notifications emitted during resume
> would be lost — nobody would be listening yet.

The TaskManager event loop drives task state transitions (`SessionReady` →
prompt, `PromptComplete` → teardown, error → fail). On `Lagged` it runs
`reconcile_after_lag` — failing any `Working` task whose thread is no longer
live and draining stranded teardowns — a safety net for transitions dropped
while the subscriber lagged.

---

## 2. MCP server is bound _before_ task resume

The MCP HTTP server binds `127.0.0.1:0` (OS-assigned free port), then
`set_mcp_port` publishes the chosen port into `AgentManager` **before** any
persisted thread is resumed.

> **Why this ordering is critical:** when a resumed agent spawns, the code reads
> the live `mcp_port` and bakes `http://127.0.0.1:{port}/mcp` plus the thread's
> bearer token into the ACP session's MCP config. `mcp_port` defaults to `0`. If
> resume ran first, every reloaded agent would get `…:0/mcp` — an invalid
> endpoint — and could never call `create_task` / `list_tasks` / `list_agents` /
> `update_task` / `complete_task`. The task graph would silently stall on every
> restart. See [Agent lifecycle & ACP](./agent-lifecycle-and-acp.md).

> **Gotcha:** the port is random per launch and is **never persisted**.
> `threads.json` records ACP session IDs, not MCP URLs; the URL is rebuilt from
> the live port at resume time. That is _why_ resume works despite an ephemeral
> port.

> **Trade-off (resilience over strictness):** MCP start failure is **non-fatal**
> — logged, and the app launches anyway. A user should still be able to open the
> UI, browse history, and manage workspaces even if the loopback bind failed;
> agents simply have no MCP endpoint that session. There is no retry loop.

---

## 3. Recovery / rehydration

All of recovery runs inside one `block_on` so the window does not appear until
persisted state is loaded. Two phases: **load everything into memory**, then
**reconcile tasks**.

**Phase 1 — per-workspace load.** For each workspace, four kinds of state are
read from its directory: agent definitions (`agents.json`), tasks
(`tasks.json`, merged into one global registry), thread mappings
(`threads.json`), and folded usage totals. The load loop is fault-isolated —
a corrupt entry is logged and skipped.

The subtle part is thread mappings. `hydrate_dormant_for_workspace` inserts each
mapping into the **dormant** map (a resumable stub with no running process), not
the live map. `list_threads` surfaces dormant stubs so the frontend can resume
them on demand.

> **Why hydrate dormant threads before stale-task recovery?** Two reasons.
> (1) A `Working` task whose thread exists only as a persisted mapping must have
> that thread in the recoverable set, or the next phase would wrongly fail it.
> (2) `threads.json` is always rebuilt from the in-memory maps, never re-read to
> mutate — so an un-hydrated mapping would be silently dropped from disk on the
> next persist.

Usage is seeded separately so the Overview dashboard shows correct cumulative
totals immediately after restart. Live per-session usage is _not_ persisted (it
is rebuilt from ACP's cumulative reporting); only folded totals survive. See
[Persistence & usage](./persistence-and-usage.md).

> **Gotcha:** the `workspace_state` read lock is explicitly dropped before phase 2. The reconcile calls re-enter the managers and may need workspace state;
> holding the read lock across them risks a deadlock.

**Phase 2 — reconcile.** `recover_stale_tasks` walks every task and forces any
`Working` task whose thread is neither live nor recoverable to `Failed`.

> **Why fail them?** Such a task points at a process that died between the last
> persist and the crash — it can make no further progress. Leaving it `Working`
> forever would strand the UI and any dependents; `Failed` is the honest
> terminal state.

> **Gotcha (naming):** `TaskState::Working { session_id }` stores the backend
> **`thread_id`**, not the ACP session ID — the field name is kept for wire
> compatibility. That is why recovery compares it against thread IDs.

Then `resume_workspace_tasks` runs for **every** workspace (in the
local-process model all workspaces are resume candidates). Per `Working` task:
skip if already live; fail if the mapping is missing or has no ACP session;
otherwise reattach via `resume_thread`. Finally `start_unblocked_tasks` spawns
any `Pending` task whose blockers are all `Completed`.

> **Why pre-seed `prompted_sessions` before resume?** When a resumed session
> comes up the event loop receives `SessionReady` and would normally send the
> initial task prompt — but a resumed task was _already_ prompted before the
> restart, so re-prompting duplicates work. Seeding the dedup guard makes the
> post-resume `SessionReady` a no-op for prompting. (Regression-tested.)

> **Invariant:** after reconcile, no task is `Working` unless its thread is
> genuinely live or just resumed. Everything else is `Failed`, `Completed`, or
> `Pending`.

> **Known edge:** a `Failed` blocker never satisfies the "all blockers
> `Completed`" gate, so failing a task during recovery can permanently stall its
> dependents — there is no failure propagation. See
> [Known limitations](./known-limitations.md).

**After recovery:** managers are registered as Tauri state (so IPC handlers can
fetch them), the tray icon and its Show / Quit menu are built (§5), and the
notification bridge task starts.

> **Trade-off (wire asymmetry):** the bridge strips the serde tag and emits only
> the inner payload for live events, whereas `get_history` returns the full
> tagged `Notification`. The frontend therefore parses two slightly different
> shapes for live vs. replayed events — intentional, for smaller live payloads.
> Documented in [Notifications & protocol](./notifications-and-protocol.md).

---

## 4. Frontend handshake

The backend is already up when the webview loads, so `initialize()` (from
`App.svelte`'s `onMount`) only has to _pull_ recovered state and _subscribe_ to
live events.

```
initialize()  [demo mode short-circuits to seeded mock data]
   │  memoized via initializePromise (idempotent; nulled on failure to retry)
   ▼
setupAfterConnect()
  1. list_workspaces / list_agent_definitions / list_tasks     → base state
  2. list_thread_mappings   → registerPersistedThread(...)      dormant "dead" stubs
  3. known_agents           → host-detected CLIs (workspace-independent)
  4. setupListeners() (agent + usage + task)  ── AFTER the initial pull
  5. syncLiveThreads()      → replay get_history + config per thread
```

Steps 1–2 mirror the Rust recovery, reading back the exact state the backend
rehydrated; persisted mappings become **dead stubs** the user can see and
resume, matching the backend's dormant map. Listeners are wired _after_ the
initial pull so the store has a base state to fold live events into (guarded to
register exactly once).

> **Gotcha:** `known_agents()` resolves CLI availability host-wide against
> `PATH`, independent of any workspace — which is why the refresh runs even with zero
> workspaces.

**Why replay history at all?** The backend recorder keeps an in-memory
notification history per thread. After a reload the webview starts empty;
`syncLiveThreads` calls `list_threads` (which returns live threads _and_ dormant
`"dead"` stubs), fetches `get_history` + `get_thread_config` per thread, and
seeds each thread's transcript. Subsequent live `thread:*` events then append on
top. On a cold restart there are no live threads, so this replays exactly the
stubs already registered in step 2.

> **Gotcha (two shapes again):** `syncLiveThreads` types history as the
> **tagged** form because `get_history` returns full `Notification`s — unlike the
> tag-stripped live events from the bridge (§3).

---

## 5. Shutdown: tray-resident, hide-vs-quit, and the watchdog

Emergent is a **background/tray app**. Closing the window does not quit it.

**Window close = hide.** The close-request handler hides the window and cancels
the close, so in-flight agent turns and tasks keep running. The user reopens via
the tray icon / Show menu. Real termination happens only through tray **Quit**
(`exit(0)`) or an OS-level quit.

**The two `AtomicBool` gates.** The `RunEvent` loop coordinates a clean teardown
with two flags:

- `cleanup_started` (test-and-set via `swap(true)`) ensures the async cleanup
  task spawns at most once — a second `ExitRequested` (which our own `exit(0)`
  produces) must not start a second teardown.
- `exit_approved` distinguishes _the user asked to quit_ from _cleanup finished,
  now really exit_. Cleanup sets it before calling `exit(0)`; the re-entrant
  `ExitRequested` sees it and returns, letting the process actually die.

**The normal path (`ExitRequested`):** prevent exit → mark cleanup started →
hide window → spawn the OS-thread watchdog → close terminal sessions → spawn an
async task that shuts down all threads (5s cap), sets `exit_approved`, and calls
`exit(0)`.

**The macOS quirk (`RunEvent::Exit`):** ⌘-Q and the menu-bar Quit skip
`ExitRequested` entirely and fire `Exit` directly (Tauri issue #9198). If
cleanup only lived in `ExitRequested`, ⌘-Q would kill the app without shutting
down agent processes, orphaning them. So `Exit` re-runs cleanup **synchronously**
(`block_on`) — there is no runtime left to `spawn` onto — guarded by
`exit_approved` so it no-ops if the async path already ran.

> **Trade-off (timeout caps):** the async path allows **5s** for thread
> shutdown; the synchronous macOS `Exit` path allows only **3s**, because macOS
> grants a limited `applicationWillTerminate` window (~5s) before force-killing,
> and the `block_on` must fit inside it.

**What cleanup does.** First `close_all_terminal_sessions()` tears down host PTYs
(fast, synchronous). Then `shutdown_all_threads(cap)` shuts down every live
thread **concurrently** via a `JoinSet`, wrapped in `timeout(cap)` →
`abort_all()` so one hung agent cannot block quit. Each `shutdown_thread`
demotes a resumable thread to a **dormant stub** and signals the agent's whole
**process group** `SIGTERM → SIGKILL`, so `bunx → node` grandchildren are never
orphaned.

> **Invariant:** quit uses `shutdown_thread` (demote), not `kill_thread`
> (purge). Threads with an ACP session survive as **resumable dormant stubs**
> across restarts — the mapping is already on disk in `threads.json` from spawn
> time. Quit is not delete. See
> [Agent lifecycle & ACP](./agent-lifecycle-and-acp.md).

**The 10-second watchdog.** A raw `std::thread` (spawned in the `ExitRequested`
path) sleeps 10s then calls `std::process::exit(1)`.

> **Why an OS thread, not a Tokio task?** The watchdog must outlive the Tokio
> runtime. During teardown the runtime is being dismantled, so a `tokio::spawn`
> timer could be cancelled along with it — exactly when the safety net is needed.
> A blocking `std::thread` sleep is immune to runtime teardown, and
> `process::exit(1)` bypasses all Rust/Tauri cleanup. It guarantees the process
> dies even if `exit(0)`, the `JoinSet`, or Tauri's own exit hangs. Exit code
> `1` marks "forced," distinguishable from a clean `0` in logs.

---

## 6. Lifecycle invariants at a glance

- **Channel before managers.** `event_tx` is created first; every emitter and
  subscriber gets a clone. (§1)
- **Subscribers before resume.** Recorder + TaskManager loop subscribe before
  recovery, so no resume-time notification is lost. (§1)
- **MCP port before task resume.** `set_mcp_port` runs before
  `resume_workspace_tasks`, so reloaded agents get a real endpoint, not port 0.
  (§2)
- **Dormant hydration before stale-task recovery.** Otherwise resumable threads
  are wrongly failed and their mappings are dropped from `threads.json`. (§3)
- **No `Working` task without a live/just-resumed thread** after recovery. (§3)
- **Close hides, Quit terminates.** Only tray Quit / `exit(0)` / OS quit ends
  the process. (§5)
- **Quit demotes (shutdown), not purges (kill).** Threads survive as dormant
  stubs across restarts. (§5)
- **The watchdog always wins.** After 10s the process exits no matter what. (§5)

---

## Related docs

- [Documentation index](../README.md)
- [System overview & design decisions](./system-overview.md)
- [Agent lifecycle & the Agent Client Protocol](./agent-lifecycle-and-acp.md)
- [Workspaces & terminal sessions](./workspaces-and-terminals.md)
- [Task graph & swarm coordination](./task-and-swarm-coordination.md)
- [Embedded MCP server, tools & token auth](./mcp-server-and-auth.md)
- [Notifications, events & the wire protocol](./notifications-and-protocol.md)
- [Persistence model & usage accounting](./persistence-and-usage.md)
- [Known limitations](./known-limitations.md)
- [Frontend architecture](../frontend/frontend-architecture.md)
- [Reference: IPC commands & Tauri events](../reference/ipc-and-events.md)
