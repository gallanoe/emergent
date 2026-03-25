# Emergent

A desktop application for running LLM agents in parallel. Spawn multiple AI agents, orchestrate them as swarms, and watch them work on tasks concurrently — all through a native chat interface.

![Preview](assets/preview.png)

## Features

- **Agent Swarms** — Run multiple LLM agents side-by-side, each working independently on tasks
- **Multi-Provider Support** — Works with Claude Code, Gemini CLI, Codex, Kiro, OpenCode, and other ACP-compatible agents
- **Real-Time Streaming** — Watch agent responses stream in with markdown rendering and thinking block display
- **Native Desktop App** — Built with Tauri 2 for a fast, lightweight experience on macOS, Windows, and Linux
- **Daemon Architecture** — Agents survive UI restarts and multiple clients can connect simultaneously

## Architecture

Emergent uses a daemon + client architecture:

- **`emergentd`** — a background daemon that manages agent lifecycles over ACP and exposes a JSON-RPC API on a Unix domain socket
- **Tauri app** — a desktop client that connects to the daemon and provides the UI

Agents keep running even when the UI is closed. Reopening the app reconnects to existing agents and replays conversation history.

```mermaid
graph TD
    subgraph Desktop App
        UI[Svelte 5 Frontend]
        TR[Tauri Rust Backend]
    end

    UI -- "Tauri IPC<br/>(invoke commands)" --> TR

    TR -- "JSON-RPC<br/>(Unix socket)" --> D

    subgraph emergentd [Daemon - emergentd]
        D[Server]
        AM[Agent Manager]
        D --> AM
    end

    AM -- "ACP<br/>(stdio)" --> A1[Agent Process 1]
    AM -- "ACP<br/>(stdio)" --> A2[Agent Process 2]
    AM -- "ACP<br/>(stdio)" --> AN[Agent Process N]

    D -. "notifications<br/>(status, messages)" .-> TR
    TR -. "Tauri events" .-> UI

    subgraph Swarm MCP
        MCP1[MCP Server<br/>emergentd --mcp-stdio]
        MCP2[MCP Server<br/>emergentd --mcp-stdio]
        MCPN[MCP Server<br/>emergentd --mcp-stdio]
    end

    A1 -- "MCP tools<br/>(list_peers, send_message, ...)" --> MCP1
    A2 -- "MCP tools" --> MCP2
    AN -- "MCP tools" --> MCPN

    MCP1 -- "JSON-RPC<br/>(Unix socket)" --> D
    MCP2 -- "JSON-RPC<br/>(Unix socket)" --> D
    MCPN -- "JSON-RPC<br/>(Unix socket)" --> D
```

**How it works:**

1. The **Svelte frontend** communicates with the **Tauri backend** via IPC commands
2. Tauri forwards all requests to the **daemon** over a JSON-RPC Unix socket — it's a thin passthrough
3. The daemon's **agent manager** spawns agent processes (Claude Code, Gemini CLI, etc.) and communicates with them over **ACP** (stdio)
4. Each agent is injected with an **MCP server** (the daemon itself in `--mcp-stdio` mode) that provides swarm tools — `list_peers`, `send_message`, `read_mailbox`, `spawn_agent`, etc.
5. MCP tool calls route back to the daemon over JSON-RPC, enabling agents to discover and message each other
6. The daemon pushes **notifications** (status changes, messages) back through Tauri events to the UI

## Tech Stack

- **Frontend:** Svelte 5, TypeScript, Tailwind CSS 4
- **Backend:** Rust, Tauri 2, Tokio
- **Protocol:** [Agent Client Protocol (ACP)](https://github.com/anthropics/agent-client-protocol) for agent communication
- **IPC:** Newline-delimited JSON-RPC 2.0 over Unix domain socket

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (1.77.2+)
- [Bun](https://bun.sh/)
- At least one supported agent CLI installed (e.g. Claude Code, Gemini CLI, Codex, Kiro, OpenCode)

### Development

```bash
# Install dependencies
bun install

# Start the daemon (terminal 1)
cargo run -p emergent-daemon

# Start the Tauri app (terminal 2)
bun run dev
```

The daemon must be running before the app can manage agents. If the daemon is not running, the app shows a "Daemon offline" status.

#### Daemon options

By default the socket is created at `$TMPDIR/emergent-<uid>/emergentd.sock` (macOS) or `$XDG_RUNTIME_DIR/emergent/emergentd.sock` (Linux). Override with:

```bash
EMERGENT_SOCKET=/tmp/my-socket.sock cargo run -p emergent-daemon
```

Enable logging:

```bash
RUST_LOG=info cargo run -p emergent-daemon
```

### Pre-commit checks

```bash
bun run prebuild          # lint + clippy + format check + typecheck
bun run test              # Vitest unit/component tests
bun run test:rust         # Rust unit + integration tests
bun run test:e2e          # Playwright E2E tests
```

### Build

```bash
cargo build -p emergent-daemon --release   # Daemon
bun run build                              # Tauri desktop app
```

### Supported agents

| Agent       | Command                     |
| ----------- | --------------------------- |
| Claude Code | `claude-agent-acp`          |
| Codex       | `codex-acp`                 |
| Gemini      | `gemini --experimental-acp` |
| Kiro        | `kiro-cli acp`              |
| OpenCode    | `opencode acp`              |

## License

MIT
