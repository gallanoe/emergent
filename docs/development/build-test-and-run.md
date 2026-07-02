# Development: Build, Run & Testing Strategy

How to get Emergent building and running locally, the pre-commit gate, and the three-layer, **Docker-free** test strategy — with the reasoning behind the harnesses, the mock-agent fixture, and CI.

> Related: [Documentation Index](../README.md) · [Agent Lifecycle & ACP](../architecture/agent-lifecycle-and-acp.md) · [Embedded MCP Server & Auth](../architecture/mcp-server-and-auth.md) · [Persistence & Usage](../architecture/persistence-and-usage.md) · [Notifications & Protocol](../architecture/notifications-and-protocol.md) · [Frontend Architecture](../frontend/frontend-architecture.md) · [Known Limitations](../architecture/known-limitations.md)

---

## Getting started

```bash
bun install     # JS/TS deps; also runs the husky `prepare` hook that installs git hooks
bun run dev     # tauri dev — builds src-tauri, starts Vite, opens the desktop shell
```

**Invariant: use `bun`, never `npm`.** The lockfile is `bun.lock` and CI installs with `--frozen-lockfile`. An `npm install` would emit a `package-lock.json` and drift the dependency graph.

**No Docker is required to build, run, or test.** Agents run as **local host processes** with an isolated `$HOME` (real Keychain / `~/.codex/auth.json` symlinked in), not inside containers. Any lingering Docker / `bollard` / `docker exec` references in `README.md`/`CLAUDE.md` are stale — there is no container backend in the shipping code. See [System Overview](../architecture/system-overview.md) and [Agent Lifecycle & ACP](../architecture/agent-lifecycle-and-acp.md).

### The Cargo `default-members` caveat

The root workspace lists all members but sets `default-members = ["crates/*"]`.

**Gotcha:** a bare root Cargo command (`build`/`test`/`check`/`clippy`) operates only on the `crates/*` libraries and **silently skips `src-tauri`**. You can pass Clippy on the core crates while the Tauri app crate is broken.

**Why:** `src-tauri` links GUI/webview system libraries and is slow to compile; excluding it from the default set keeps iteration on `emergent-core`/`emergent-protocol` fast.

**Fix:** always pass `--workspace` (or `-p <crate>`) for full coverage. The Bun wrappers already do — `test:rust` and `lint:rust` both run `--workspace` — so prefer them over bare `cargo`.

---

## Pre-commit checklist

All commands are `package.json` scripts. Run the full set before committing:

```bash
bun run lint          # oxlint (JS/TS)
bun run lint:rust     # clippy --workspace, warnings = errors
bun run fmt:check     # prettier (Svelte) + oxfmt (JS/TS)
bun run typecheck     # svelte-check
bun run test          # Vitest unit/component
bun run test:rust     # cargo test --workspace (incl. mock-agent E2E)
bun run test:frontend # Playwright
```

`bun run prebuild` chains only the non-test checks (`lint`, `lint:rust`, `fmt:check`, `typecheck`). It is the fast "does it compile and lint" gate, **not** a substitute for the test scripts.

**Gotcha (formatting scope):** `fmt:check` covers Svelte (Prettier) and JS/TS (oxfmt). It does **not** run `rustfmt`/`cargo fmt` — Rust style is policed by Clippy instead. Don't assume `bun run fmt` touched your `.rs` files.

**Gotcha (`clippy -D warnings`):** every Clippy warning is a hard error — an unused import or a needless clone fails the build. Fix warnings rather than `#[allow]`-ing them, absent a documented reason.

**Gotcha (husky is a partial gate):** the installed `.husky/pre-commit` runs only `lint` and `fmt:check` on every commit — not `typecheck`, not tests, not `rustfmt`. A commit can pass the local hook yet fail in CI. **CI is the automated gate of record.**

---

## Test strategy: three Docker-free layers

Emergent is tested in three layers that avoid Docker and, wherever possible, the network. The design goal: the _entire_ suite — including one live agent-lifecycle end-to-end test — runs deterministically on a plain CI runner with no Docker daemon.

```
Layer 1  Rust unit + integration   crates/emergent-core/tests/*, #[cfg(test)] modules
         real object graph in-process; one live mock-agent E2E as a host process
Layer 2  Vitest + Testing Library   src/**/*.test.ts — jsdom + mocked Tauri IPC
Layer 3  Playwright                  tests/frontend/*.spec.ts — real Svelte app under Vite
```

**Why three layers:** each buys a different guarantee. Layer 1 pins backend wire contracts (MCP auth, tool gating, persistence, usage math, the ACP turn) without a UI. Layer 2 pins store/component logic in isolation with fast feedback. Layer 3 proves the assembled app boots and renders real user flows in a real browser.

**Invariant: no test touches Docker or a real container.** Even the live agent test spawns the mock-agent as a local host process — this mirrors the shipping architecture, where there is no containerized path to exercise.

---

## Layer 1 — Rust unit & integration tests

Run with `bun run test:rust`. Integration suites live in `crates/emergent-core/tests/` (an `integration.rs` covering the MCP/auth/gating/usage/E2E surface, plus focused suites for thread rehydration and usage math), sitting on top of many inline `#[cfg(test)]` unit tests across `emergent-core` and `emergent-protocol`.

### The test-server harness

`spawn_test_server_with_events` (and its event-less sibling) builds the **real** backend object graph in-process — a live `TokenRegistry`, `AgentManager`, and `TaskManager` wired to a real Axum MCP server. The server binds `127.0.0.1:0` (ephemeral port) so suites run in parallel without collisions.

**Why real components, not mocks:** these are _contract_ tests. Substituting fakes for the managers would test the fakes, not the auth-and-gating behavior agents actually depend on. See [Embedded MCP Server & Auth](../architecture/mcp-server-and-auth.md).

### MCP auth & tool-gating contracts

Tests POST hand-built JSON-RPC bodies via `reqwest`, with or without a `Bearer` token, and assert on the response **body text**.

- **Invariant (errors are in-band):** MCP errors come back as **HTTP 200 with the error embedded in the JSON-RPC body**, not as a non-2xx status. Do not "fix" a test by expecting 401/500.
- **Tool gating by session type:** a token is minted with an agent id plus an optional task id. No task id ⇒ a _conversation_ session; a task id ⇒ a _task_ session. `complete_task` and `update_task` are filtered out of `tools/list` for conversation sessions, so the model never sees a tool it cannot usefully call. (The always-available tools are `create_task`, `list_tasks`, and `list_agents`.)
- **Gotcha:** task tools must be visible _during the ACP handshake_, before any live `ThreadHandle` exists — which is **why the task id is captured at token-mint time**, not looked up from a running thread.
- The revoke path is pinned too: mint → confirm works → `revoke_agent` → confirm subsequent calls fail.

### Thread rehydration contracts

The rehydration tests use `tempfile::TempDir` scratch dirs and `_for_test` seams to drive the real `ThreadManager` through a simulated restart: hydrate dormant mappings → persist to `threads.json` → a fresh manager reloads and re-hydrates → assert the entry survived.

Two teardown invariants are pinned explicitly, because they encode when a resumable stub _should_ and _should not_ exist:

- **`shutdown_thread` demotes a thread that has an ACP session** to a resumable dormant stub.
- **`shutdown_thread` must NOT leave a stub for a session-less thread** (killed mid-handshake) — there is nothing to resume, so a stub would be a dead phantom.

Backward compatibility is covered by loading an old bare-array `threads.json` into the current envelope. See [Persistence & Usage](../architecture/persistence-and-usage.md) for the v0/v1 format.

### Usage-pipeline tests

Split into two flavors: **pure-function** tests (delta accumulation, ring-buffer eviction, v0/v1 JSON parsing — fast, no I/O) and a **live-recorder** test that sends usage notifications through the _actual_ broadcast channel the background recorder subscribes to. The live test is what pins the load-bearing accounting rules: cumulative-per-session reporting is converted to **per-turn deltas**, the cost branch is folded in, and a **new session after a kill is not clamped** (its fresh delta adds rather than resets).

**Gotcha (timing/flakiness):** the recorder is a real background task, so these tests use fixed short `sleep` waits. Under load that is a potential flake source — intermittent failures here point at scheduling latency, not the accounting logic.

### The one live mock-agent E2E

A single test drives the **full agent lifecycle** — spawn → ACP handshake → prompt → streamed tool call + message → complete — running the mock-agent as a local host process. A helper resolves the compiled binary via `current_exe()` path arithmetic and falls back to `cargo build -p mock-agent` if a narrower `cargo test -p emergent-core` skipped building it.

**Invariant (subscribe-before-spawn):** `tokio::broadcast` does **not** replay history to late subscribers. Subscribe to the event channel _before_ spawning the thread, or the one-shot `SessionReady` can be missed and the test hangs to timeout. Any new event-driven test must subscribe first.

**Why `--workspace` matters here:** it compiles every member (including the mock-agent) up front, so the helper fast-paths to the artifact instead of paying for the slower build-on-demand fallback.

---

## The mock-agent fixture

`crates/mock-agent/` is a small ACP agent built on the `agent_client_protocol` builder, speaking the protocol over stdio. It implements the handshake and config methods (initialize, new-session, set-config-option) and a prompt handler.

**Why it exists:** it is a **deterministic ACP peer with no real LLM** — no API keys, no network, no non-determinism, no Docker. This is what lets Layer 1 exercise the real spawn/handshake/stream/complete pipeline reproducibly in CI.

Prompt handling is **substring-driven**: a case-insensitive match on the prompt text selects a behavior. Keywords like `use tools`, `think first`, `slow response`, `long response`, `usage`, and `error` each trigger a scripted response (tool call, thinking chunks, delayed chunks, a usage event, an ACP error, …); anything else echoes the prompt back in a few chunks. The `usage` branch additionally attaches usage to the prompt response so the `acp_bridge` extraction path gets exercised.

**Gotcha:** the module doc-comment also lists a `"request permission"` behavior, but **there is no code path for it** — that branch is unimplemented. Don't write a test that depends on it.

**Trade-off:** substring dispatch is trivially deterministic and easy to extend, but it makes prompt text **load-bearing** — a prompt that accidentally contains one of these keywords triggers the wrong fixture branch.

---

## Layer 2 — Vitest + Testing Library

Run with `bun run test` (config in `vitest.config.ts`: `jsdom`, the Svelte plugins, browser resolve conditions, and a setup file). It excludes the Playwright dir, scripts, and node_modules.

### `src/test-setup.ts` shims (the WHY)

The setup file installs jsdom shims so Svelte 5 stores/components load and settle without a real Tauri host:

- **A global `__TAURI_INTERNALS__` stub** (plus event-plugin internals) so any module importing `@tauri-apps/api` loads under jsdom, with `invoke` resolving to null.
- **An `Element.prototype.animate` override.** _Subtle gotcha:_ Svelte 5 drives transition intros/outros through the Web Animations API and completes them via `onfinish`. jsdom's built-in stub never fires `onfinish`, so **transition OUTROS never complete and `{#if}` content is never removed** (intros look fine because they mount immediately). The override finishes on the next microtask, so collapse/slide transitions settle deterministically instead of hanging the test.
- **In-memory `localStorage` and a `matchMedia` shim** — the theme store reads both, and jsdom under Vitest can omit or break them.

### How Layer 2 tests drive the app

- Store tests intercept `invoke` **by command name** (`mockIPC`/`clearMocks`), call store methods, `flushSync()`, and assert on rune state.
- The `agentStore` exposes a **`_test` seam** — internal handlers, chunk buffers, and thread inject/remove — so tests drive store logic directly without going through IPC. Some tests also assert that _removed_ legacy exports are gone, locking the public surface.
- Component tests render with `@testing-library/svelte` and query via `screen`.

**Trade-off:** mocking IPC by command name is fast and isolated but only as accurate as the mocked responses. It cannot catch a mismatch between the Rust command signature and the frontend's expectations — that is Layer 3's (and Layer 1's) job. See [Frontend Architecture](../frontend/frontend-architecture.md) and the [IPC & Events reference](../reference/ipc-and-events.md).

---

## Layer 3 — Playwright frontend tests

Run with `bun run test:frontend` (config in `playwright.config.ts`: Chromium only, screenshot on failure). The `webServer` runs `bunx vite` on port 1420 with `reuseExistingServer`.

**Invariant:** Playwright exercises the _real Svelte app under Vite_ against a hand-written `window.__TAURI_INTERNALS__` stub — **not** the full `tauri dev` desktop shell. There is no Rust backend behind these tests; the "backend" is whatever the injected script returns.

The specs come in two mock styles:

### (a) Demo-mode specs (the default)

Most specs call a shared `setupMocks` helper that injects the Tauri mock **before navigation**. The mock sets `window.__EMERGENT_DEMO_MODE__ = true` and stubs `invoke` to return empty results. In demo mode the app self-seeds from `src/stores/mock-data.svelte.ts`, so these specs test navigation and rendering against known seed data.

**Why a runtime demo flag:** the dev server is built once with `VITE_DEMO_MODE=false`; injecting the runtime toggle per-page lets the same Vite build serve both demo and non-demo specs without a rebuild.

### (b) Scripted non-demo specs

A couple of specs run _without_ demo mode, scripting per-command `invoke` responses directly:

- One returns an **empty world** so startup lands on the empty-workspace CTA, asserting the app renders immediately with no splash/loading state.
- One scripts a single-workspace/single-thread world and additionally captures `listen()` handlers so the test can **synthesize backend Tauri events** and assert on the resulting DOM.

**Why:** demo mode can't cover empty-state startup or event-driven UI. Scripting IPC — and, in one case, synthesizing events — is how Layer 3 exercises the empty path and the notification → store → render path without a live backend. See [Notifications & Protocol](../architecture/notifications-and-protocol.md).

**Gotcha:** `test:frontend` needs the Chromium browser installed. CI runs `bunx playwright install --with-deps chromium`; locally run `bunx playwright install chromium` once if the first run fails to launch. (`tests/frontend/phase-7-visual-qa.md` is a manual checklist, not an automated spec.)

---

## CI wiring

`.github/workflows/ci.yml` runs on push/PR to `main` (concurrency-cancelled) on `ubuntu-24.04`. It installs the WebKitGTK/appindicator system libs the Tauri crate needs, caches Cargo and `node_modules`, then runs the checks as **individual steps** in roughly this order: install → lint → fmt:check → typecheck → Vitest → install Chromium → Playwright → `cargo check --workspace` → `lint:rust` → `test:rust`.

**Notes:**

- There is **no Docker step** — reinforcing that the whole suite is Docker-free.
- CI uses `--workspace` throughout, so it _does_ cover `src-tauri` even though a bare local `cargo` wouldn't (see the `default-members` caveat).
- Running individual steps (rather than `prebuild` + a test alias) keeps failures attributable to a specific stage.

---

## Quick reference

| I want to…                                | Command                                                       |
| ----------------------------------------- | ------------------------------------------------------------- |
| Run the app                               | `bun run dev`                                                 |
| Full pre-commit gate                      | `bun run prebuild`, then `test`, `test:rust`, `test:frontend` |
| Only backend tests (incl. mock-agent E2E) | `bun run test:rust`                                           |
| One Rust test                             | `cargo test --workspace <name>`                               |
| Only frontend unit/component tests        | `bun run test`                                                |
| One Vitest file                           | `bunx vitest run src/stores/agents.svelte.test.ts`            |
| Only Playwright                           | `bun run test:frontend` (install Chromium first if needed)    |

See also: [Runtime Lifecycle](../architecture/runtime-lifecycle.md) · [Known Limitations](../architecture/known-limitations.md) · back to the [Documentation Index](../README.md).
