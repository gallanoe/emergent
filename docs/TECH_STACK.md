Monorepo & Tooling

- Package manager: Bun (workspace-based monorepo)
- Build orchestration: Turborepo
- Linting/Formatting: Oxlint + Oxfmt (Rust-based)
- Language: TypeScript 5.7 (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess)

Desktop Shell

- Electron v40 with electron-updater for auto-updates

Frontend (apps/web)

- React 19 with the React Compiler (babel plugin)
- Vite 8 (beta) as build tool
- Routing: TanStack Router (file-based)
- State: Zustand + TanStack Query
- Styling: Tailwind CSS v4 + Class Variance Authority + Tailwind Merge
- UI primitives: Base UI (headless components) + Lucide icons
- Rich text/editor: Lexical
- Markdown: react-markdown + remark-gfm
- Diff rendering: @pierre/diffs
- Terminal: xterm.js
- Virtualization: TanStack Virtual

Backend (apps/server)

- Runtime: Node.js, built/dev'd with Bun
- Core paradigm: Effect (functional effect system used pervasively for services, error handling, and composition)
- WebSocket server: ws
- PTY management: node-pty
- Database: SQLite via @effect/sql-sqlite-bun
- CLI framework: Effect CLI
- Bundler: tsdown

Shared Packages

- packages/contracts: Schema-only package using Effect's Schema module — defines the WebSocket protocol, provider events, model types, etc.
- packages/shared: Runtime utilities with explicit subpath exports (/git, /logging, /shell, /Net, /model) — no barrel index.

Testing

- Vitest v4 across all packages
- Playwright + Vitest Browser mode for web integration tests
- MSW (Mock Service Worker) for API mocking
- @effect/vitest for Effect-based test utilities on the server