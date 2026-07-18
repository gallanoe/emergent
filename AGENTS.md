# Emergent

A Tauri 2 desktop application for running LLM agents in parallel as isolated local host processes. Agents communicate via the Agent Client Protocol (ACP) and work on tasks concurrently through a chat-based interface.

## Architecture

The Tauri app embeds the agent, workspace, and task managers directly — there is no separate daemon process. Each agent runs as a local host process (no Docker), isolated by its own working directory and `$HOME`. Agent threads connect back to the embedded MCP HTTP server over bearer-token authenticated HTTP calls.

- **Tauri app** (in `src-tauri/`) — desktop app that owns the `AgentManager`, `WorkspaceManager`, and `TaskManager`, spawns agent processes over ACP as local host processes, and runs the embedded MCP HTTP server used by agent threads
- **`emergent-core`** (in `crates/emergent-core/`) — core library containing agent orchestration, workspace management, host terminal sessions, the MCP server, the task graph, swarm coordination, and system-prompt logic
- **`emergent-protocol`** (in `crates/emergent-protocol/`) — shared types and notification definitions used by both the Tauri app and core library

At startup, the Tauri app creates the `WorkspaceManager` (which loads persisted workspaces from `~/.emergent/`), creates the `AgentManager` and `TaskManager`, starts the embedded MCP HTTP server, rehydrates persisted threads/tasks, and bridges notifications to the Svelte frontend via Tauri events.

## Tech Stack

- **Frontend:** Svelte 5, TypeScript, Tailwind CSS 4, Vite 7
- **Backend:** Rust (edition 2021), Tauri 2, Tokio (async runtime)
- **Execution:** Local host processes, isolated per-agent by working directory + `$HOME` (no Docker)
- **Protocol:** Agent Client Protocol (ACP) for agent communication
- **MCP transport:** Streamable HTTP served by the embedded app
- **Testing:** Vitest + Testing Library (unit/component), Playwright (frontend), `cargo test --workspace` (Rust)
- **Linting/Formatting:** oxlint (JS/TS), Clippy (Rust), Prettier + oxfmt (formatting)
- **Package Manager:** Bun (use `bun` instead of `npm`)

## Project Structure

```
Cargo.toml                    # Workspace root

src/                          # Frontend (Svelte 5 + TypeScript)
├── components/               # Svelte components
│   ├── agent/                # AgentCreatorView, ThreadListView, ThreadListSection, SystemPromptCard
│   ├── chat/                 # ChatArea, ChatInput, StreamingMarkdown, tool-call renders, ToolCallRow
│   ├── overview/             # OverviewView dashboard + metric tiles
│   ├── settings/             # AppSettingsView, WorkspaceSettingsView, ConfigRow, ThemeSelect
│   ├── sidebar/              # InnerSidebar, WorkspaceSwitcher, ContextMenu
│   ├── tasks/                # TaskTableView, TaskDetailSidebar, CreateTaskSidebar
│   ├── terminal/             # TerminalView (xterm.js)
│   └── *.svelte              # Shared dialogs like CreateWorkspaceDialog, SearchCommand
├── stores/                   # Rune-based state (.svelte.ts files)
│   ├── app-state.svelte.ts   # Central app state (workspaces, agents, views)
│   ├── agents.svelte.ts      # Agent connection + streaming store
│   ├── usage.svelte.ts       # Per-workspace token/cost usage
│   ├── theme.svelte.ts       # Theme persistence
│   ├── mock-data.svelte.ts   # Demo/test data helpers
│   ├── mock-token-metrics.svelte.ts # Demo/test token-usage fixtures
│   └── types.ts              # Shared display types
├── lib/                      # Utility functions (render-markdown, highlight, tool-call parsing, ...)
│   └── primitives/           # Shared UI primitives (Button, Input, Card, Badge, ConfirmDialog, StatusDot, TaskStatusPill, ...)
├── App.svelte                # Root layout component
└── main.ts                   # Vite entry point

src-tauri/                    # Tauri app (embeds the managers + MCP server)
├── src/
│   ├── main.rs               # Tauri app entry
│   ├── lib.rs                # App setup, manager wiring, notification bridge
│   ├── commands.rs           # Tauri IPC command handlers
│   └── tray.rs               # System tray icon setup
├── build.rs
├── Cargo.toml
└── tauri.conf.json

crates/
├── emergent-core/            # Core library (embedded in Tauri app)
│   ├── src/
│   │   ├── lib.rs            # Public modules
│   │   ├── agent/            # Agent lifecycle and ACP communication
│   │   │   ├── mod.rs        # AgentManager coordinator
│   │   │   ├── acp_bridge.rs # ACP client adapter + command loop
│   │   │   ├── lifecycle.rs  # Agent spawn/resume (local process) + ACP handshake
│   │   │   ├── prompt_loop.rs # Prompt wake/inject/send cycle
│   │   │   ├── registry.rs   # Agent definition persistence
│   │   │   ├── spawner.rs    # Agent spawner trait + local-process implementation
│   │   │   ├── thread_manager.rs # Running thread lifecycle + history
│   │   │   └── usage_store.rs # Per-workspace token/cost accounting
│   │   ├── workspace/        # Workspace management (host directories, no containers)
│   │   │   ├── mod.rs        # WorkspaceManager (CRUD, lifecycle)
│   │   │   ├── paths.rs      # ~/.emergent path layout
│   │   │   ├── state.rs      # Workspace state types (SharedWorkspaceState)
│   │   │   └── terminal.rs   # Host PTY terminal sessions (portable_pty)
│   │   ├── mcp/              # MCP server and auth
│   │   │   ├── mod.rs        # Re-exports
│   │   │   ├── handler.rs    # MCP tool implementations (create/list/update/complete task, list_agents)
│   │   │   ├── http_server.rs # Axum HTTP server
│   │   │   └── token_registry.rs # Bearer token management
│   │   ├── task/            # Task graph
│   │   │   ├── mod.rs        # TaskManager, subscription registry + event loop
│   │   │   ├── registry.rs   # Task persistence
│   │   │   └── subscribe.rs  # SubscribeMode enum (notification tiers)
│   │   ├── swarm/            # Inter-agent coordination
│   │   │   ├── mod.rs        # Re-exports
│   │   │   └── system_prompt.rs # System block injection
│   │   ├── config.rs         # ACP config conversion
│   │   └── detect.rs         # Agent binary detection
│   └── tests/
│       ├── integration.rs    # Integration tests
│       ├── thread_rehydration.rs # Dormant-thread rehydration tests
│       └── usage_aggregator.rs   # Usage accounting tests
├── emergent-protocol/        # Shared types
│   └── src/
│       ├── lib.rs
│       ├── types.rs          # Notification and payload types
│       └── task.rs           # Task types
└── mock-agent/               # Test-only ACP agent (prompt-driven behavior)
    └── src/
        └── main.rs

tests/frontend/               # Playwright frontend tests (mocked Tauri IPC)
.github/workflows/            # CI (ci.yml) and release (release.yml)
```

## Running the Project

```bash
# Install dependencies
bun install

# Start the Tauri app (agent manager runs embedded)
bun run dev
```

Agents run as local host processes, so no Docker is required. Install at least one supported agent CLI on your `PATH` (see the README for the list); the app detects available agents on startup.

## Best Practices

### Skills

- **Load the `svelte-5` skill** when working on frontend code (`src/`).
- **Load the `rust` skill** when working on backend code (`src-tauri/` or `crates/`).
- **Load the `desktop-utility-design` skill** when working on UI/UX patterns.

### Code Style

- Use Svelte 5 runes (`$state`, `$derived`, `$effect`) — not legacy reactive syntax.
- Frontend stores use `.svelte.ts` extension for rune support.
- Rust code must pass `clippy -- -D warnings` (warnings treated as errors).
- Always use `bun` to run scripts, never `npm`.
- Stage specific files with git — never use `git add -A` or `git add .`.

## Pre-Commit Checks

Run all of the following before committing:

```bash
# Lint
bun run lint                    # JS/TS linting (oxlint)
bun run lint:rust               # Rust linting (clippy, warnings = errors)

# Format
bun run fmt:check               # Check Prettier + oxfmt formatting

# Type check
bun run typecheck               # svelte-check + TypeScript

# Tests
bun run test                    # Vitest unit/component tests
bun run test:rust               # Rust unit + integration tests (all workspace crates)
bun run test:frontend           # Playwright frontend tests (starts bunx vite)
```

Or run the combined pre-build check (lint + lint:rust + fmt:check + typecheck):

```bash
bun run prebuild
```

## Contributor Notes

- The Cargo workspace sets `default-members = ["crates/*"]`, so prefer `cargo check --workspace`, `cargo test --workspace`, or the Bun wrappers over bare root `cargo` commands when you want coverage that includes `src-tauri`.
- Playwright frontend tests use the Vite web server (`bunx vite` on port `1420`) plus mocked Tauri IPC, not the full `tauri dev` desktop shell.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
