# Emergent

A Tauri 2 desktop application for running LLM agents in parallel. Agents communicate via the Agent Client Protocol (ACP) and work on documents concurrently through a chat-based interface.

## Architecture

Emergent uses a daemon + client architecture:

- **`emergentd`** (in `crates/emergent-daemon/`) — background daemon that manages agent lifecycles over ACP and exposes a JSON-RPC API on a Unix domain socket
- **Tauri app** (in `src-tauri/`) — thin desktop client that connects to the daemon and provides the UI
- **`emergent-protocol`** (in `crates/emergent-protocol/`) — shared types, JSON-RPC client, and socket path resolution used by both daemon and Tauri app

The Tauri app is a passthrough — all agent management (spawn, prompt, cancel, kill) is delegated to the daemon via JSON-RPC. The app bridges daemon notifications to the frontend via Tauri events.

## Tech Stack

- **Frontend:** Svelte 5, TypeScript, Tailwind CSS 4, Vite 7
- **Backend:** Rust (edition 2021), Tauri 2, Tokio (async runtime)
- **Protocol:** Agent Client Protocol (ACP) for agent communication
- **IPC:** Newline-delimited JSON-RPC 2.0 over Unix domain socket
- **Testing:** Vitest + Testing Library (unit/component), Playwright (E2E), `cargo test` (Rust)
- **Linting/Formatting:** oxlint (JS/TS), Clippy (Rust), Prettier + oxfmt (formatting)
- **Package Manager:** Bun (use `bun` instead of `npm`)

## Project Structure

```
Cargo.toml                    # Workspace root

src/                          # Frontend (Svelte 5 + TypeScript)
├── components/               # Svelte components (ChatArea, Sidebar, TopBar, ChatInput)
├── stores/                   # Rune-based state (.svelte.ts files)
├── lib/                      # Utility functions
├── App.svelte                # Root layout component
└── main.ts                   # Vite entry point

src-tauri/                    # Tauri app (thin client to daemon)
├── src/
│   ├── main.rs               # Tauri app entry
│   ├── lib.rs                # DaemonConnection setup + notification bridge
│   └── commands.rs           # Tauri IPC command handlers (passthroughs to daemon)
├── Cargo.toml
└── tauri.conf.json

crates/
├── emergent-daemon/          # Daemon binary (emergentd)
│   ├── src/
│   │   ├── main.rs           # CLI entry, socket server, signal handling
│   │   ├── lib.rs            # Public modules + run_server()
│   │   ├── server.rs         # JSON-RPC request dispatch + notification broadcast
│   │   ├── agent_manager.rs  # ACP client + agent lifecycle management
│   │   ├── detect.rs         # Agent binary detection
│   │   └── socket.rs         # Stale socket detection, PID file management
│   └── tests/
│       └── integration.rs    # Daemon integration tests
├── emergent-protocol/        # Shared types + client
│   └── src/
│       ├── lib.rs
│       ├── types.rs          # JSON-RPC, notification, and payload types
│       ├── client.rs         # DaemonClient (JSON-RPC over Unix socket)
│       └── socket.rs         # Socket path resolution
└── mock-agent/               # Test-only ACP agent (prompt-driven behavior)
    └── src/
        └── main.rs

e2e/                          # Playwright E2E tests
.github/workflows/            # CI (ci.yml) and release (release.yml)
```

## Running the Project

The daemon must be running before the Tauri app can manage agents:

```bash
# Terminal 1: start daemon
cargo run -p emergent-daemon

# Terminal 2: start Tauri app
bun run dev
```

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
bun run test:e2e                # Playwright E2E tests (needs dev server)
```

Or run the combined pre-build check (lint + fmt:check + typecheck):

```bash
bun run prebuild
```
