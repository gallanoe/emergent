# Emergent

A Tauri 2 desktop application for running LLM agents in parallel. Agents communicate via the Agent Client Protocol (ACP) and work on documents concurrently through a chat-based interface.

## Tech Stack

- **Frontend:** Svelte 5, TypeScript, Tailwind CSS 4, Vite 7
- **Backend:** Rust (edition 2021), Tauri 2, Tokio (async runtime)
- **Protocol:** Agent Client Protocol (ACP) for agent communication
- **Testing:** Vitest + Testing Library (unit/component), Playwright (E2E), `cargo test` (Rust)
- **Linting/Formatting:** oxlint (JS/TS), Clippy (Rust), Prettier + oxfmt (formatting)
- **Package Manager:** Bun (use `bun` instead of `npm`)

## Project Structure

```
src/                          # Frontend (Svelte 5 + TypeScript)
├── components/               # Svelte components (ChatArea, Sidebar, TopBar, ChatInput)
├── stores/                   # Rune-based state (.svelte.ts files)
├── lib/                      # Utility functions
├── App.svelte                # Root layout component
└── main.ts                   # Vite entry point

src-tauri/                    # Backend (Rust + Tauri)
├── src/
│   ├── main.rs               # Tauri app entry
│   ├── lib.rs                 # Module exports
│   ├── commands.rs            # Tauri IPC command handlers
│   ├── detect.rs              # Agent binary detection
│   └── agent_manager.rs       # ACP client + agent lifecycle management
├── Cargo.toml
└── tauri.conf.json

e2e/                          # Playwright E2E tests
.claude/skills/               # Skill references (svelte-5, rust, desktop-utility-design)
.github/workflows/            # CI (ci.yml) and release (release.yml)
```

## Best Practices

### Skills

- **Load the `svelte-5` skill** when working on frontend code (`src/`).
- **Load the `rust` skill** when working on backend code (`src-tauri/`).
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
bun run test:rust               # Rust unit tests
bun run test:e2e                # Playwright E2E tests (needs dev server)
```

Or run the combined pre-build check (lint + fmt:check + typecheck):

```bash
bun run prebuild
```
