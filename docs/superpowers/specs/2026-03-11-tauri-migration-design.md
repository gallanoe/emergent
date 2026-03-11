# Tauri Migration Design

**Date:** 2026-03-11
**Status:** Draft

## Overview

Migrate the Emergent (Overstory UI) project from an Electron + Effect-TS monorepo scaffold to a flat Tauri v2 + React project. The current scaffold is a barebones desktop app with minimal frontend code, so the migration is a clean-slate rebuild in-place on a migration branch.

The long-term vision is a spatial workspace desktop application — tabbed editor panes, persistent chat panel, embedded AI agents — think Obsidian with agentic capabilities. This migration establishes the foundation.

## Goals

- Replace Electron with Tauri v2 as the desktop shell
- Replace Effect-TS backend with a Rust backend skeleton (Tauri commands)
- Flatten the monorepo into a single-project structure
- Preserve the React + Tailwind + Vite + Zustand frontend stack
- Set up GitHub Actions CI/CD for Tauri (multi-platform builds)
- Drop all unnecessary dependencies (Effect, TanStack, Turborepo, Electron)

## Non-Goals

- LLM provider integration or agent orchestration
- Database setup (SQLite)
- CRUD operations for sessions, history, or documents
- Code signing / notarization
- Any application features beyond a working Tauri shell

## Project Structure

```
emergent/
├── src/                          # React frontend
│   ├── main.tsx                  # React entry point
│   ├── index.css                 # Tailwind directives
│   ├── App.tsx                   # Root component
│   └── vite-env.d.ts
├── src-tauri/                    # Rust backend (Tauri)
│   ├── src/
│   │   ├── main.rs               # Tauri entry point
│   │   └── lib.rs                # Command definitions
│   ├── build.rs                  # Tauri build script (required by Tauri build system)
│   ├── Cargo.toml
│   ├── tauri.conf.json           # Tauri config (window, bundle, etc.)
│   ├── capabilities/             # Tauri v2 permission capability JSON files
│   │                             #   (grants frontend access to Tauri APIs: shell, dialog, etc.)
│   └── icons/                    # App icons
├── docs/                         # Design specs and documentation
├── index.html                    # Vite HTML entry
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
├── package.json                  # Bun scripts, dependencies
├── .oxlintrc.json
├── .oxfmtrc.json
├── .github/
│   └── workflows/
│       ├── ci.yml                # Lint, typecheck, test, build
│       └── release.yml           # Multi-platform Tauri builds + GitHub Release
└── .gitignore
```

## Frontend Stack

| Concern | Choice | Notes |
|---------|--------|-------|
| UI Library | React 19 | Latest stable |
| Build Tool | Vite | Latest stable release (current project uses v8 beta — downgrade to latest stable or use v8 if stable by implementation time) |
| Tauri IPC | @tauri-apps/api | Required for frontend to invoke Rust commands |
| Styling | Tailwind CSS v4 | Utility-first |
| State Management | Zustand | Workspace state tree — drives all view navigation and app state |
| Language | TypeScript (strict) | `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` |
| Testing | Vitest | Unit tests |
| Linting | Oxlint | Rust-based, fast |
| Formatting | Oxfmt | Rust-based, fast |

### No Router

The application is a spatial workspace with concurrent, independent UI surfaces (tabbed panes, persistent panels, background agents projecting state into multiple views). Navigation is workspace state mutation (opening tabs, splitting panes, toggling panels), not page transitions. Zustand is the correct primitive; a router would be vestigial.

## Rust Backend (src-tauri)

Skeleton only for this migration:

- **Tauri v2** latest stable
- **Rust toolchain:** stable (installed via `rustup` in CI; Tauri v2 specifies its own MSRV)
- **@tauri-apps/cli** as a devDependency for `tauri dev` / `tauri build` commands
- Default `main.rs` / `lib.rs` / `build.rs` with Tauri app builder
- A single `greet` command to verify frontend-to-Rust IPC works
- Default window config: single main window loading Vite dev server (dev) or bundled frontend (prod)

Future work (out of scope):
- SQLite via `rusqlite` or `sqlx` for persistence
- Tauri commands for CRUD (agent sessions, history, documents)
- Direct HTTP calls to LLM provider APIs from Rust

## CI/CD (GitHub Actions)

### ci.yml — Pull Requests and Pushes to `main`

1. Install Bun + Rust stable toolchain + system dependencies (Linux: `libwebkit2gtk-4.1-dev`, etc.)
2. Cache: Bun modules + Cargo registry/target
3. Lint (Oxlint)
4. Format check (Oxfmt)
5. Typecheck (`tsc --noEmit`)
6. Test (Vitest)
7. Rust check (`cargo check` in `src-tauri/` — verifies Rust compiles without full bundle, much faster than `cargo tauri build`)

### release.yml — Version Tags (`v*.*.*`) or Manual Dispatch

1. Preflight: lint, typecheck, test
2. Build matrix using `tauri-apps/tauri-action`:
   - macOS arm64 (`.dmg`)
   - macOS x64 (`.dmg`)
   - Linux x64 (`.AppImage`, `.deb`)
   - Windows x64 (`.msi`, `.nsis`)
3. Upload artifacts
4. Create GitHub Release with artifacts

Code signing is deferred. Workflows will include comments indicating where signing configuration goes.

## What Gets Removed

- `apps/` — Electron shell, Effect server, web frontend (moved to `src/`)
- `packages/` — contracts (Effect Schema), shared (version utility)
- `scripts/` — Effect-based dev-runner and build-desktop-artifact
- `turbo.json` — no monorepo orchestration needed
- `tsconfig.base.json` — replaced by single root `tsconfig.json`
- `.canopy/`, `.mulch/`, `.overstory/`, `.seeds/`, `.turbo/` — dot directories
- `AGENTS.md` — references removed tooling
- `.github/workflows/` — rewritten from scratch for Tauri

### Dependencies Removed

- Effect ecosystem: `effect`, `@effect/platform-node`, `@effect/sql-sqlite-bun`, `@effect/vitest`, `@effect/language-service`
- Electron ecosystem: `electron`, `electron-updater`, `electron-builder`
- TanStack ecosystem: `@tanstack/react-router`, `@tanstack/react-query`, related plugins
- Build orchestration: `turbo`
- WebSocket: `ws`

## Migration Strategy

1. Create a migration branch from `main`
2. Remove all old scaffold files (single commit)
3. Delete `bun.lock` (will be regenerated from new `package.json`)
4. Initialize Tauri v2 project with React + Vite frontend
5. Configure Tailwind v4, Zustand, TypeScript strict mode, Vitest, Oxlint, Oxfmt
6. Update `.gitignore` — add `src-tauri/target/`, remove Electron/TanStack patterns
7. Verify `bun run dev` opens a Tauri window with the React app
8. Write CI/CD workflows for Tauri
9. Verify CI passes

## Package Manager

Bun for JavaScript dependencies and script running. Cargo for Rust dependencies (managed by Tauri).

## Key Decisions Log

| Decision | Rationale |
|----------|-----------|
| Clean slate over incremental migration | Current scaffold is barebones; nothing meaningful to preserve |
| Flat structure over monorepo | Single app, no shared packages needed |
| Zustand over router for navigation | Spatial workspace model, not page-based navigation |
| Drop Effect entirely | Rust replaces the Node.js backend; Effect was backend-only |
| Drop TanStack Router/Query | Desktop app doesn't benefit from URL-driven routing or remote server state caching |
| Defer code signing | Can be added later via env vars; builds work unsigned |
| Defer database/LLM/agent setup | Migration scope is the shell only |
