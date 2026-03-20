# Emergent

A desktop application for running LLM agents in parallel. Spawn multiple AI agents, orchestrate them as swarms, and watch them work on tasks concurrently — all through a native chat interface.

![Preview](assets/preview.png)

## Features

- **Agent Swarms** — Run multiple LLM agents side-by-side, each working independently on tasks
- **Multi-Provider Support** — Works with Claude Code, Gemini CLI, Codex, and other ACP-compatible agents
- **Real-Time Streaming** — Watch agent responses stream in with markdown rendering and thinking block display
- **Native Desktop App** — Built with Tauri 2 for a fast, lightweight experience on macOS, Windows, and Linux

## Tech Stack

- **Frontend:** Svelte 5, TypeScript, Tailwind CSS 4
- **Backend:** Rust, Tauri 2, Tokio
- **Protocol:** [Agent Client Protocol (ACP)](https://github.com/anthropics/agent-client-protocol) for agent communication

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (1.77.2+)
- [Bun](https://bun.sh/)
- At least one supported agent CLI installed (e.g. Claude Code, Gemini CLI, Codex)

### Development

```bash
# Install dependencies
bun install

# Start the dev server
bun run dev
```

### Build

```bash
bun run build
```

## License

MIT
