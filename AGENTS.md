# Emergent

A Tauri 2 desktop application for running LLM agents in parallel. Agents communicate via the Agent Client Protocol (ACP) and work on documents concurrently through a chat-based interface.

## Architecture

The Tauri app embeds the agent manager directly — there is no separate daemon process. MCP sidecars connect back to the app via an HTTP server.

- **Tauri app** (in `src-tauri/`) — desktop app that owns the `AgentManager`, spawns agent processes over ACP, and runs an MCP HTTP server for sidecar tool calls
- **`emergent-core`** (in `crates/emergent-core/`) — core library containing agent orchestration, MCP server, swarm coordination, and system prompt logic (embedded into the Tauri app)
- **`emergent-protocol`** (in `crates/emergent-protocol/`) — shared types and notification definitions used by both the Tauri app and core library

The Tauri app creates the `AgentManager` at startup, starts an MCP HTTP server, and bridges agent notifications to the Svelte frontend via Tauri events.

## Tech Stack

- **Frontend:** Svelte 5, TypeScript, Tailwind CSS 4, Vite 7
- **Backend:** Rust (edition 2021), Tauri 2, Tokio (async runtime)
- **Protocol:** Agent Client Protocol (ACP) for agent communication
- **IPC:** JSON-RPC 2.0 over HTTP (MCP sidecars to app)
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

src-tauri/                    # Tauri app (embeds agent manager)
├── src/
│   ├── main.rs               # Tauri app entry
│   ├── lib.rs                # AgentManager setup, MCP HTTP server, notification bridge
│   ├── commands.rs           # Tauri IPC command handlers
│   └── tray.rs               # System tray icon setup
├── Cargo.toml
└── tauri.conf.json

crates/
├── emergent-core/            # Core library (embedded in Tauri app)
│   ├── src/
│   │   ├── lib.rs            # Public modules
│   │   ├── agent/            # Agent lifecycle and ACP communication
│   │   │   ├── mod.rs        # AgentManager public API
│   │   │   ├── acp_bridge.rs # ACP client adapter + command loop
│   │   │   ├── lifecycle.rs  # Agent spawn + ACP handshake
│   │   │   └── prompt_loop.rs # Prompt wake/inject/send cycle
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
