# Phase 7 visual QA

Checked against `docs/design/v1/project/` mocks in `bun run dev` demo mode on macOS. Dates: 2026-04-22.

> Note: `docs/` is gitignored in this repository; this checklist is stored under `e2e/` so it can be versioned with the Playwright suite.

## Artboard parity

| artboard                 | light | dark | notes |
| ------------------------ | ----- | ---- | ----- |
| app-overview             | ✅    | ✅   |       |
| app-chat-markdown        | ✅    | ✅   |       |
| app-chat (task session)  | ✅    | ✅   |       |
| app-chat-free            | ✅    | ✅   |       |
| app-threads              | ✅    | ✅   |       |
| app-threads-overflow     | ✅    | ✅   |       |
| app-tasks                | ✅    | ✅   |       |
| app-settings (workspace) | ✅    | ✅   |       |
| app-app-settings         | ✅    | ✅   |       |

## Known deltas

- Agent avatars use CLI logos with no tile (README #7) — intentional.
- Queue-while-working composer shows both interrupt and send buttons (README #9) — intentional deviation from mock.
- Hero kebab on agent page has `Delete agent` only; rename and edit role happen inline on the hero (Phase 3 C3.4).

## Deferred

- `TODO(real-metrics)` — token + runtime metrics wired to backend.
- `TODO(search)` — ⌘K command palette.
