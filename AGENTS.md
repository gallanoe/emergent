# Emergent

A Tauri 2 desktop application for running LLM agents in parallel inside containerized workspaces. Agents communicate via the Agent Client Protocol (ACP) and work on tasks concurrently through a chat-based interface.

## Architecture

The Tauri app embeds the agent manager and workspace manager directly — there is no separate daemon process. Agent threads connect back to the embedded MCP HTTP server over bearer-token authenticated HTTP calls.

- **Tauri app** (in `src-tauri/`) — desktop app that owns the `AgentManager` and `WorkspaceManager`, spawns agent processes over ACP inside Docker containers, and runs the embedded MCP HTTP server used by agent threads
- **`emergent-core`** (in `crates/emergent-core/`) — core library containing agent orchestration, workspace/container management, terminal sessions, MCP server, swarm coordination, and system prompt logic
- **`emergent-protocol`** (in `crates/emergent-protocol/`) — shared types and notification definitions used by both the Tauri app and core library

At startup, the Tauri app connects to Docker, creates the `WorkspaceManager` (which loads persisted workspaces and inspects container states), creates the `AgentManager`, starts an MCP HTTP server, and bridges notifications to the Svelte frontend via Tauri events.

## Tech Stack

- **Frontend:** Svelte 5, TypeScript, Tailwind CSS 4, Vite 7
- **Backend:** Rust (edition 2021), Tauri 2, Tokio (async runtime)
- **Containers:** Docker (via bollard crate), per-workspace isolation
- **Protocol:** Agent Client Protocol (ACP) for agent communication
- **MCP transport:** Streamable HTTP served by the embedded app
- **Testing:** Vitest + Testing Library (unit/component), Playwright (E2E), `cargo test --workspace` (Rust)
- **Linting/Formatting:** oxlint (JS/TS), Clippy (Rust), Prettier + oxfmt (formatting)
- **Package Manager:** Bun (use `bun` instead of `npm`)

## Project Structure

```
Cargo.toml                    # Workspace root

src/                          # Frontend (Svelte 5 + TypeScript)
├── components/               # Svelte components
│   ├── agent/                # AgentCreatorView, AgentSettingsView, ThreadListView
│   ├── chat/                 # ChatArea, ChatInput
│   ├── swarm/                # SwarmRail, SwarmView
│   ├── sidebar/              # InnerSidebar, ContextMenu, AgentPickerPopover
│   ├── settings/             # SettingsView, GeneralTab, ContainerTab
│   ├── terminal/             # TerminalView (xterm.js)
│   ├── topbar/               # TopBar, SettingsPopover
│   └── *.svelte              # Shared dialogs like CreateWorkspaceDialog, ConfirmDialog
├── stores/                   # Rune-based state (.svelte.ts files)
│   ├── app-state.svelte.ts   # Central app state (workspaces, agents, views)
│   ├── agents.svelte.ts      # Agent connection store
│   ├── theme.svelte.ts       # Theme persistence
│   ├── mock-data.svelte.ts   # Demo/test data helpers
│   └── types.ts              # Shared display types
├── lib/                      # Utility functions
├── App.svelte                # Root layout component
└── main.ts                   # Vite entry point

src-tauri/                    # Tauri app (embeds agent manager + workspace manager)
├── src/
│   ├── main.rs               # Tauri app entry
│   ├── lib.rs                # App setup, Docker connection, notification bridge
│   ├── commands.rs           # Tauri IPC command handlers
│   └── tray.rs               # System tray icon setup
├── Cargo.toml
└── tauri.conf.json

crates/
├── emergent-core/            # Core library (embedded in Tauri app)
│   ├── src/
│   │   ├── lib.rs            # Public modules
│   │   ├── agent/            # Agent lifecycle and ACP communication
│   │   │   ├── mod.rs        # AgentManager coordinator
│   │   │   ├── acp_bridge.rs # ACP client adapter + command loop
│   │   │   ├── lifecycle.rs  # Agent spawn/resume via docker exec + ACP handshake
│   │   │   ├── prompt_loop.rs # Prompt wake/inject/send cycle
│   │   │   ├── registry.rs   # Agent definition persistence
│   │   │   ├── spawner.rs    # Agent spawner trait + Docker implementation
│   │   │   └── thread_manager.rs # Running thread lifecycle + history
│   │   ├── workspace/        # Workspace and container management
│   │   │   ├── mod.rs        # WorkspaceManager (CRUD, container lifecycle)
│   │   │   ├── container.rs  # Docker operations (build, start, stop, remove)
│   │   │   ├── state.rs      # Workspace state types (SharedWorkspaceState)
│   │   │   └── terminal.rs   # Terminal sessions via docker exec
│   │   ├── mcp/              # MCP server and auth
│   │   │   ├── mod.rs        # Re-exports
│   │   │   ├── handler.rs    # MCP tool implementations
│   │   │   ├── http_server.rs # Axum HTTP server
│   │   │   └── token_registry.rs # Bearer token management
│   │   ├── swarm/            # Inter-agent coordination
│   │   │   ├── mod.rs        # Re-exports
│   │   │   ├── mailbox.rs    # Message queue
│   │   │   ├── topology.rs   # Connection graph
│   │   │   └── system_prompt.rs # System block injection
│   │   ├── config.rs         # ACP config conversion
│   │   └── detect.rs         # Agent binary detection
│   └── tests/
│       └── integration.rs    # Integration tests
├── emergent-protocol/        # Shared types
│   └── src/
│       ├── lib.rs
│       └── types.rs          # Notification and payload types
└── mock-agent/               # Test-only ACP agent (prompt-driven behavior)
    └── src/
        └── main.rs

e2e/                          # Playwright E2E tests
.github/workflows/            # CI (ci.yml) and release (release.yml)
```

## Running the Project

```bash
# Install dependencies
bun install

# Start the Tauri app (agent manager runs embedded)
bun run dev
```

Docker Desktop must be running for workspace containers to work. The app will start without Docker but workspaces cannot be created.

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
bun run test:e2e                # Playwright E2E tests (starts bunx vite)
```

Or run the combined pre-build check (lint + lint:rust + fmt:check + typecheck):

```bash
bun run prebuild
```

## Contributor Notes

- The Cargo workspace sets `default-members = ["crates/*"]`, so prefer `cargo check --workspace`, `cargo test --workspace`, or the Bun wrappers over bare root `cargo` commands when you want coverage that includes `src-tauri`.
- Playwright E2E uses the Vite web server (`bunx vite` on port `1420`) plus mocked Tauri IPC, not the full `tauri dev` desktop shell.
