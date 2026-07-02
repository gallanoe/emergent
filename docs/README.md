# Emergent — Documentation Index & Reading Path

Emergent is a Tauri 2 desktop app that runs multiple LLM coding agents in parallel, each as an isolated **local host process** driven over the Agent Client Protocol (ACP), coordinated through an embedded MCP server and a chat UI. Read this page first — it is the map.

---

## ⚠️ Correction note (read before the code or the top-level docs)

**The shipping architecture runs each agent as a local host process. There is no Docker, no containers, no `bollard`, and no `docker exec` anywhere in the codebase.**

- **What isolation actually is:** each agent gets its own `$HOME` (a directory under `~/.emergent/<workspace-id>/agents/<agent>/`), with the real macOS **Keychain** and `~/.codex/auth.json` **symlinked in** so OAuth/credential flows still work. Isolation is per-agent `$HOME`, not per-workspace container.
- **The backend is embedded in the Tauri app** — there is no separate daemon. Any "daemon" references in code (e.g. `get_daemon_status` hardcoding `"connected"`) are legacy IPC-contract stubs; treat the embedded-in-Tauri model as canonical.

> **Gotcha — historical drift.** Earlier `CLAUDE.md`, `AGENTS.md`, and the top-level `README.md` described per-workspace Docker containers, a `bollard` dependency, `container.rs`, and `docker exec`. Wherever that container-era vocabulary survives, **treat it as stale** — the docs in _this_ directory are authoritative, and Docker is a **non-goal**, not a hidden dependency. Verified against source: agents are spawned by `LocalProcessSpawner` (`agent/spawner.rs`); terminals are host PTYs via `portable_pty` (`workspace/terminal.rs`); no `bollard`, `docker exec`, or `container.rs` exist.

---

## Reading path

Read top-to-bottom; each step assumes the previous. This is also the complete docs map — every doc appears here once.

1. **[System Overview & Design Decisions](architecture/system-overview.md)** — the system end-to-end and the _why_ behind the load-bearing decisions. Start here.
2. **[Application Lifecycle: Boot, Recovery, Shutdown](architecture/runtime-lifecycle.md)** — how the app assembles itself, rehydrates state after a restart, and tears down cleanly from the tray. The backbone every subsystem hangs off.
3. **Per-subsystem deep dives** (any order once you have the overview):
   - **[Agent Lifecycle & ACP](architecture/agent-lifecycle-and-acp.md)** — the two-phase cancellable spawn, the dedicated-OS-thread ACP client, the prompt loop, and the `$HOME`/auth-symlink isolation model.
   - **[Workspaces & Terminals](architecture/workspaces-and-terminals.md)** — `WorkspaceManager` CRUD, the `~/.emergent/<id>/` on-disk layout, and out-of-band host-PTY terminal streaming.
   - **[Task Graph & Swarm Coordination](architecture/task-and-swarm-coordination.md)** — the task state machine and dependency graph, and why the swarm topology is decorative while the MCP task tools are the real coordination path.
   - **[Embedded MCP Server & Auth](architecture/mcp-server-and-auth.md)** — the loopback Axum MCP server, its task tools (`create_task` / `list_tasks` / `list_agents` / `update_task` / `complete_task`), and the mint-before-spawn per-thread bearer-token model.
   - **[Notifications, Events & the Wire Protocol](architecture/notifications-and-protocol.md)** — the one-way `broadcast` → Tauri bridge → webview pipeline, the live-vs-replayed event asymmetry, and the shared `emergent-protocol` contract.
   - **[Persistence & Usage](architecture/persistence-and-usage.md)** — the in-memory-authoritative JSON-on-disk data model and the cumulative-vs-delta token/cost accounting.
4. **[Frontend Architecture](frontend/frontend-architecture.md)** — the Svelte 5 rune stores, the router-less `activeView` shell, and the block-by-block streaming chat + tool-call render pipeline.
5. **[IPC Commands & Tauri Events Reference](reference/ipc-and-events.md)** — tabular reference of the IPC handlers and event channels, plus the cross-manager guards and legacy stubs. Keep open while reading the others.
6. **[Development: Build, Run & Testing](development/build-test-and-run.md)** — getting running with Bun, the pre-commit gate, and the three-layer Docker-free test strategy.
7. **[Known Limitations](architecture/known-limitations.md)** — accepted trade-offs, footguns, and open design questions. Read before making changes.

---

## Crate & directory legend

| Path                        | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`                      | **Frontend** — Svelte 5 + TypeScript. Components under `components/`, rune state under `stores/` (`.svelte.ts`). No router; `App.svelte` switches views by `activeView`. See [frontend-architecture](frontend/frontend-architecture.md).                                                                                                                                                                                                                  |
| `src-tauri/`                | **Tauri app layer** — the desktop shell that **embeds** the whole backend: `lib.rs` (bootstrap, recovery, shutdown, notification bridge), `commands.rs` (the `#[tauri::command]` IPC handlers), `tray.rs`. Owns the `Arc`-shared managers.                                                                                                                                                                                                                |
| `crates/emergent-core/`     | **Core library** — all orchestration: `agent/` (AgentManager, ThreadManager, ACP bridge, prompt loop, two-phase spawn, `LocalProcessSpawner`, registry, usage store), `workspace/` (WorkspaceManager, host-PTY terminals), `task/` (TaskManager + event loop — the task graph and the real inter-agent coordination path), `mcp/` (Axum server, handler, token registry), `swarm/` (topology + system-block injection), plus `config.rs` and `detect.rs`. |
| `crates/emergent-protocol/` | **Shared wire types** — the `Notification` enum and payload structs (serde) used by every layer; the single source of truth for the event/IPC contract. See [notifications-and-protocol](architecture/notifications-and-protocol.md).                                                                                                                                                                                                                     |
| `crates/mock-agent/`        | **Test-only ACP agent** — a prompt-substring-driven fixture for the Rust integration test and the end-to-end harness. Not shipped.                                                                                                                                                                                                                                                                                                                        |

> **Naming gotcha.** On disk the spawner is `LocalProcessSpawner` (`agent/spawner.rs`, running the agent CLI directly via `tokio::process::Command`) — there is no `container.rs`. Older container-era vocabulary (a `container.rs` module, a spawner "Docker implementation") no longer matches source; trust the source and this docs set.
