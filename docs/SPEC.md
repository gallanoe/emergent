# Overstory UI — Scaffold Spec

> **Goal:** Stand up the monorepo skeleton so that `bun run dev` opens an empty Electron window, CI passes on every push, and the desktop artifact pipeline can produce a signed `.dmg`/`.AppImage`/`.nsis`. No Overstory features yet — just the scaffold.

---

## 1. Repository Layout

Adopt the t3code monorepo structure. The `emergent` repo becomes the monorepo root.

```
emergent/
├── apps/
│   ├── web/                 # React + Vite frontend (renderer)
│   ├── server/              # Node.js + Effect backend (WebSocket + CLI)
│   └── desktop/             # Electron shell
├── packages/
│   ├── contracts/           # Effect Schema contracts (schema-only, no runtime)
│   └── shared/              # Runtime utilities (subpath exports, no barrel)
├── scripts/                 # Build & dev tooling (Effect CLI runners)
├── docs/                    # Specs, architecture docs
├── .github/workflows/       # CI + Release pipelines
├── package.json             # Root workspace config
├── turbo.json               # Turborepo task graph
├── tsconfig.base.json       # Shared TypeScript base config
├── .oxlintrc.json           # Oxlint rules
├── .oxfmtrc.json            # Oxfmt config
└── vitest.config.ts         # Root Vitest config
```

### Workspace Registration (root `package.json`)

```jsonc
{
  "name": "@emergent/monorepo",
  "private": true,
  "type": "module",
  "workspaces": {
    "packages": ["apps/*", "packages/*", "scripts"]
  },
  "packageManager": "bun@1.3.9",
  "engines": {
    "bun": "^1.3.9",
    "node": "^24.13.1"
  }
}
```

---

## 2. Tech Stack (per `TECH_STACK.md`)

| Layer | Choice | Notes |
|-------|--------|-------|
| Package manager | Bun | Workspace-based monorepo |
| Build orchestration | Turborepo | Task graph with `^build` deps |
| Lint / Format | Oxlint + Oxfmt | Rust-based, fast |
| Language | TypeScript 5.7+ | `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` |
| Desktop shell | Electron 40 | `electron-updater` for auto-updates |
| Frontend framework | React 19 | React Compiler (babel plugin) |
| Build tool | Vite 8 | Dev server + production builds |
| Routing | TanStack Router | File-based routes |
| State | Zustand + TanStack Query | Client state + server state |
| Styling | Tailwind CSS v4 | + CVA + tailwind-merge |
| UI primitives | Base UI | Headless components + Lucide icons |
| Server runtime | Node.js (built with Bun) | Effect-TS for services/composition |
| WebSocket | ws | Server ↔ renderer communication |
| Database | SQLite via `@effect/sql-sqlite-bun` | Effect SQL integration |
| Server bundler | tsdown | ESM output |
| Testing | Vitest 4 | + Playwright browser mode, MSW, `@effect/vitest` |

---

## 3. Scaffold Deliverables

Each deliverable is a concrete, mergeable unit of work.

### 3.1 Root Configuration Files

**Files to create:**

| File | Purpose |
|------|---------|
| `package.json` | Workspaces, catalog deps, scripts, engines |
| `turbo.json` | Task graph (`build`, `dev`, `typecheck`, `test`) |
| `tsconfig.base.json` | Shared TS config (ES2023, ESNext modules, Bundler resolution, strict) |
| `.oxlintrc.json` | Oxlint plugins (eslint, oxc, react, unicorn, typescript), category severity |
| `.oxfmtrc.json` | Oxfmt formatting rules |
| `vitest.config.ts` | Root Vitest config with path aliases |
| `.gitignore` | `node_modules`, `dist`, `dist-electron`, `.turbo`, `.env*` |

**Root scripts (modeled on t3code):**

```jsonc
{
  "scripts": {
    "dev": "node scripts/dev-runner.ts dev",
    "dev:server": "node scripts/dev-runner.ts dev:server",
    "dev:web": "node scripts/dev-runner.ts dev:web",
    "dev:desktop": "node scripts/dev-runner.ts dev:desktop",
    "start": "turbo run start --filter=@emergent/server",
    "start:desktop": "turbo run start --filter=@emergent/desktop",
    "build": "turbo run build",
    "build:desktop": "turbo run build --filter=@emergent/desktop --filter=@emergent/server",
    "typecheck": "turbo run typecheck",
    "lint": "oxlint --report-unused-disable-directives",
    "fmt": "oxfmt",
    "test": "turbo run test",
    "test:desktop-smoke": "turbo run smoke-test --filter=@emergent/desktop",
    "dist:desktop:artifact": "node scripts/build-desktop-artifact.ts",
    "dist:desktop:dmg": "node scripts/build-desktop-artifact.ts --platform mac --target dmg",
    "dist:desktop:linux": "node scripts/build-desktop-artifact.ts --platform linux --target AppImage --arch x64",
    "dist:desktop:win": "node scripts/build-desktop-artifact.ts --platform win --target nsis --arch x64",
    "clean": "rm -rf node_modules apps/*/node_modules packages/*/node_modules apps/*/dist apps/*/dist-electron packages/*/dist .turbo apps/*/.turbo packages/*/.turbo"
  }
}
```

**Turborepo task graph:**

```jsonc
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "dist-electron/**"]
    },
    "dev": {
      "dependsOn": ["@emergent/contracts#build"],
      "cache": false,
      "persistent": true
    },
    "typecheck": {
      "dependsOn": ["^typecheck"],
      "outputs": [],
      "cache": false
    },
    "test": {
      "dependsOn": ["^build"],
      "cache": false,
      "outputs": []
    }
  }
}
```

### 3.2 `packages/contracts`

Schema-only package. No runtime logic.

- **Name:** `@emergent/contracts`
- **Build:** tsdown (ESM + CJS dual export)
- **Contents (scaffold):** A single placeholder schema (e.g., `AppEvent`) using Effect Schema to prove the build pipeline works
- **Tests:** One Vitest test asserting schema encode/decode round-trips

### 3.3 `packages/shared`

Runtime utilities with explicit subpath exports (no barrel index).

- **Name:** `@emergent/shared`
- **Build:** tsdown (ESM)
- **Contents (scaffold):** A single subpath export `/version` that re-exports the monorepo version string
- **Tests:** One Vitest test

### 3.4 `apps/server`

Minimal Effect-TS server with WebSocket endpoint.

- **Name:** `@emergent/server`
- **Build:** tsdown (ESM)
- **Runtime:** Node.js (dev'd/built with Bun)
- **Contents (scaffold):**
  - Effect-based main entry (`src/main.ts`) that starts a `ws` WebSocket server
  - A health-check WS message handler (client sends `{ type: "ping" }`, server responds `{ type: "pong" }`)
  - CLI entry via Effect CLI
  - Port configuration via env var `EMERGENT_PORT` (default `3773`)
- **Tests:** One `@effect/vitest` test asserting ping/pong round-trip

### 3.5 `apps/web`

Minimal React + Vite frontend.

- **Name:** `@emergent/web`
- **Build:** Vite 8
- **Contents (scaffold):**
  - `vite.config.ts` with React plugin + TanStack Router plugin + Tailwind CSS plugin
  - `vitest.browser.config.ts` for Playwright browser tests
  - Tailwind CSS v4 setup (CSS-first config)
  - TanStack Router with file-based routing, a single `__root.tsx` layout and `/` index route
  - Index route renders a centered heading: `"Overstory"` with Tailwind styling
  - Port `5733` (configurable via `PORT` env var)
  - HMR WebSocket protocol config for Electron compatibility
- **Tests:**
  - One Vitest unit test (e.g., route config loads)
  - One Playwright browser test (renders heading text)

### 3.6 `apps/desktop`

Electron shell that loads the Vite dev server (dev) or bundled web app (prod).

- **Name:** `@emergent/desktop`
- **Build:** tsdown → `dist-electron/main.js` + `dist-electron/preload.js`
- **Bundle ID:** `com.emergent.overstory`
- **Contents (scaffold):**
  - `src/main.ts` — creates a `BrowserWindow`, loads `VITE_DEV_SERVER_URL` or `file://dist/index.html`
  - `src/preload.ts` — context bridge exposing `desktopBridge` with `getWsUrl()` for server connection
  - `tsdown.config.ts` — builds main + preload as CJS (Electron requirement)
  - `electron-launcher.mjs` — custom macOS app bundle creator (patch Info.plist, bundle ID, icons)
  - `electron-updater` integration stub (configured but no update server yet)
- **Tests:**
  - Smoke test script (`scripts/smoke-test.mjs`) — launches Electron, asserts window title, exits
  - Preload bundle verification (grep for `desktopBridge` and `getWsUrl` in output)

### 3.7 `scripts/`

Development tooling package.

- **Name:** `@emergent/scripts`
- **Contents (scaffold):**
  - `dev-runner.ts` — Effect CLI that orchestrates parallel dev processes:
    - Builds contracts first
    - Starts server and web dev servers in parallel
    - Port offset support via `EMERGENT_PORT_OFFSET` env var
    - Configurable state directory: `~/.emergent/dev`
  - `build-desktop-artifact.ts` — Effect CLI for desktop distribution builds:
    - `--platform mac|linux|win`
    - `--target dmg|AppImage|nsis`
    - `--arch arm64|x64`
    - Apple notarization + code signing hooks (stubbed)

---

## 4. CI/CD Pipelines

### 4.1 CI Pipeline (`.github/workflows/ci.yml`)

Runs on every PR and push to `main`.

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  quality:
    name: Lint, Typecheck, Test, Browser Test, Build
    runs-on: blacksmith-4vcpu-ubuntu-2404
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: package.json

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version-file: package.json

      - name: Cache Bun and Turbo
        uses: actions/cache@v4
        with:
          path: |
            ~/.bun/install/cache
            .turbo
          key: ${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}-${{ hashFiles('turbo.json') }}
          restore-keys: |
            ${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}-

      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: ${{ runner.os }}-playwright-${{ hashFiles('bun.lock') }}
          restore-keys: |
            ${{ runner.os }}-playwright-

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Lint
        run: bun run lint

      - name: Typecheck
        run: bun run typecheck

      - name: Test
        run: bun run test

      - name: Install browser test runtime
        run: |
          cd apps/web
          bunx playwright install --with-deps chromium

      - name: Browser test
        run: bun run --cwd apps/web test:browser

      - name: Build desktop pipeline
        run: bun run build:desktop

      - name: Verify preload bundle output
        run: |
          test -f apps/desktop/dist-electron/preload.js
          grep -nE "desktopBridge|getWsUrl" apps/desktop/dist-electron/preload.js
```

### 4.2 Release Pipeline (`.github/workflows/release.yml`)

Triggers on version tags (`v*.*.*`) or manual dispatch.

**Stages:**

1. **Preflight** — lint, typecheck, test (reuses CI logic)
2. **Build** — matrix across platforms:
   - macOS arm64 (`macos-14`) → `.dmg`
   - macOS x64 (`macos-15-intel`) → `.dmg`
   - Linux x64 (`ubuntu-24.04`) → `.AppImage`
   - Windows x64 (`windows-2022`) → `.nsis`
3. **Sign** — Apple notarization + Azure Trusted Signing (Windows)
4. **GitHub Release** — upload all artifacts
5. **Finalize** — version bump commit to `main`

---

## 5. TypeScript Configuration

### Base Config (`tsconfig.base.json`)

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx"
  }
}
```

Each workspace extends this base and overrides only what it needs (e.g., `apps/desktop` uses `"module": "CommonJS"` for Electron main process).

---

## 6. Linting & Formatting

### Oxlint (`.oxlintrc.json`)

```jsonc
{
  "plugins": ["eslint", "oxc", "react", "unicorn", "typescript"],
  "categories": {
    "correctness": "warn",
    "suspicious": "warn",
    "perf": "warn"
  },
  "rules": {
    "react/react-in-jsx-scope": "off",
    "no-shadow": "off",
    "no-await-in-loop": "off"
  },
  "ignorePatterns": [
    "dist/", "dist-electron/", "node_modules/",
    "bun.lock", "*.gen.ts"
  ]
}
```

### Oxfmt (`.oxfmtrc.json`)

```jsonc
{
  "formatter": {
    "experimentalSortPackageJson": true
  },
  "ignorePatterns": [
    "dist/", "dist-electron/", "node_modules/",
    "bun.lock", "*.gen.ts"
  ]
}
```

---

## 7. Testing Strategy

| Layer | Tool | Scope |
|-------|------|-------|
| Unit | Vitest 4 | All packages and apps |
| Server | `@effect/vitest` | Effect service tests |
| Browser | Playwright + Vitest browser mode | Web app integration |
| API mocking | MSW | Mock external APIs in web tests |
| Desktop smoke | Custom script | Launch Electron, assert window, exit |
| Preload verification | Shell grep | Assert required exports in preload bundle |

**Scaffold test counts (minimum viable):**

| Package | Tests |
|---------|-------|
| `packages/contracts` | 1 (schema round-trip) |
| `packages/shared` | 1 (version export) |
| `apps/server` | 1 (ping/pong) |
| `apps/web` | 1 unit + 1 browser |
| `apps/desktop` | 1 smoke |

---

## 8. Development Workflow

### First-time setup

```bash
bun install
```

### Development (all apps)

```bash
bun run dev          # contracts build → server + web in parallel
```

### Development (desktop)

```bash
bun run dev:desktop  # contracts build → server + web + electron in parallel
```

### Quality checks (what CI runs)

```bash
bun run lint         # Oxlint
bun run typecheck    # tsc --noEmit across all workspaces
bun run test         # Vitest across all workspaces
```

### Desktop distribution

```bash
bun run dist:desktop:dmg          # macOS .dmg (native arch)
bun run dist:desktop:linux        # Linux .AppImage
bun run dist:desktop:win          # Windows .nsis
```

---

## 9. Acceptance Criteria

The scaffold is complete when all of the following are true:

- [ ] `bun install` succeeds with no errors
- [ ] `bun run lint` passes clean
- [ ] `bun run typecheck` passes clean
- [ ] `bun run test` — all scaffold tests pass
- [ ] `bun run dev` — Vite dev server starts, browser shows "Overstory" heading
- [ ] `bun run dev:desktop` — Electron window opens showing the web app
- [ ] `bun run build` — all workspaces produce output in `dist/`
- [ ] `bun run build:desktop` — produces `dist-electron/main.js` + `dist-electron/preload.js`
- [ ] CI pipeline passes on GitHub Actions (lint → typecheck → test → browser test → build)
- [ ] No Overstory business logic exists — only scaffold infrastructure

---

## 10. Out of Scope (Future Work)

These are explicitly **not** part of the scaffold and will be specced separately:

- Overstory data models and schemas in `contracts`
- WebSocket protocol for agent status, mail, metrics
- Dashboard views (agent fleet, merge queue, event feed)
- Terminal emulation (xterm.js)
- Diff rendering (@pierre/diffs)
- Rich text editing (Lexical)
- SQLite integration for Overstory databases
- Auto-update server and electron-updater configuration
- Marketing site (`apps/marketing`)
