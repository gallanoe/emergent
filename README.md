# Emergent

A desktop application for running LLM agents in parallel inside containerized workspaces. Spawn multiple AI agents, orchestrate them as swarms, and watch them work on tasks concurrently — all through a native chat interface.

![Preview](assets/preview.png)

## Features

- **Containerized Workspaces** — Each workspace runs inside a Docker container with its own filesystem, tools, and terminal. Create, stop, start, and delete workspaces from the sidebar
- **Agent Swarms** — Run multiple LLM agents side-by-side within a workspace, each working independently on tasks
- **Agent Roles** — Assign optional roles to agents (e.g. "Code reviewer", "Test writer") to shape their behavior
- **Swarm Communication** — Agents can discover peers, send messages, and collaborate through built-in mailbox tools
- **Management Permissions** — Grant agents the ability to spawn, kill, and connect other agents in the swarm
- **Integrated Terminal** — Open terminal sessions directly into workspace containers from the sidebar
- **Multi-Provider Support** — Works with Claude Code, Gemini CLI, Codex, Kiro, OpenCode, and other ACP-compatible agents
- **Real-Time Streaming** — Watch agent responses stream in with markdown rendering and thinking block display
- **Native Desktop App** — Built with Tauri 2 for a fast, lightweight experience on macOS, Windows, and Linux

## Architecture

The Tauri app embeds the agent manager directly — there is no separate daemon process. An HTTP server runs inside the app to serve MCP tool calls from agent sidecars.

```mermaid
graph TD
    subgraph Tauri App
        UI[Svelte 5 Frontend]
        TR[Tauri Rust Backend]
        AM[Agent Manager]
        WM[Workspace Manager]
        HS[HTTP Server]
    end

    UI -- "Tauri IPC<br/>(invoke commands)" --> TR
    TR --> AM
    TR --> WM

    WM -- "Docker API<br/>(bollard)" --> D[Docker Engine]
    D --> C1[Container: Workspace 1]
    D --> C2[Container: Workspace 2]

    AM -- "ACP<br/>(docker exec)" --> A1[Agent in Container 1]
    AM -- "ACP<br/>(docker exec)" --> A2[Agent in Container 2]

    AM -. "notifications<br/>(broadcast)" .-> TR
    TR -. "Tauri events" .-> UI

    subgraph MCP Sidecars
        MCP1[emergentd --mcp-stdio]
        MCP2[emergentd --mcp-stdio]
    end

    A1 -- "MCP tools<br/>(list_peers, send_message, ...)" --> MCP1
    A2 -- "MCP tools" --> MCP2

    MCP1 -- "JSON-RPC<br/>(HTTP)" --> HS
    MCP2 -- "JSON-RPC<br/>(HTTP)" --> HS
    HS --> AM
```

**How it works:**

1. The user creates a **workspace**, which builds a Docker image from a Dockerfile and starts a container
2. The **Svelte frontend** communicates with the **Tauri backend** via IPC commands
3. The Tauri backend owns the **agent manager** and **workspace manager**. Agents are spawned inside workspace containers via `docker exec` and communicate over **ACP** (stdio)
4. Each agent is injected with an **MCP sidecar** (`emergentd --mcp-stdio`) that provides swarm tools — `list_peers`, `send_message`, `read_mailbox`, `spawn_agent`, etc.
5. MCP tool calls route back to the app's **HTTP server** over JSON-RPC, enabling agents to discover and message each other
6. On the first prompt, the app prepends an invisible **system prompt** with a swarm collaboration guide, the agent's role (if set), and instructions for using swarm tools
7. The agent manager pushes **notifications** (status changes, messages, permission changes) through Tauri events to the UI

## Tech Stack

- **Frontend:** Svelte 5, TypeScript, Tailwind CSS 4
- **Backend:** Rust, Tauri 2, Tokio
- **Containers:** Docker (via bollard), per-workspace isolation
- **Protocol:** [Agent Client Protocol (ACP)](https://github.com/anthropics/agent-client-protocol) for agent communication
- **IPC:** JSON-RPC 2.0 over HTTP (MCP sidecars to app)

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (1.77.2+)
- [Bun](https://bun.sh/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (required for workspace containers)
- At least one supported agent CLI installed (e.g. Claude Code, Gemini CLI, Codex, Kiro, OpenCode)

### Development

```bash
# Install dependencies
bun install

# Start the Tauri app
bun run dev
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
bun run build             # Tauri desktop app (includes agent manager)
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
