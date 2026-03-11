# Tauri Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Electron + Effect-TS monorepo scaffold with a flat Tauri v2 + React project.

**Architecture:** Single-project layout with `src/` (React frontend) and `src-tauri/` (Rust backend). Bun for JS dependencies, Cargo for Rust. No monorepo tooling. Zustand for state management, no router.

**Tech Stack:** Tauri v2 (~2.10), React 19, Vite 7.x, Tailwind CSS v4, Zustand, TypeScript (strict), Vitest, Oxlint, Oxfmt, Bun

**Spec:** `docs/superpowers/specs/2026-03-11-tauri-migration-design.md`

---

## Chunk 1: Teardown

### Task 1: Create Migration Branch

**Files:**
- None (git operation only)

- [ ] **Step 1: Create and switch to migration branch**

```bash
git checkout -b tauri-migration
```

- [ ] **Step 2: Commit**

No commit needed — empty branch creation.

---

### Task 2: Remove Old Scaffold

**Files:**
- Delete: `apps/` (entire directory)
- Delete: `packages/` (entire directory)
- Delete: `scripts/` (entire directory)
- Delete: `turbo.json`
- Delete: `tsconfig.base.json`
- Delete: `vitest.config.ts` (will be recreated)
- Delete: `.canopy/`, `.mulch/`, `.overstory/`, `.seeds/`
- Delete: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Delete: `AGENTS.md`
- Delete: `.gitattributes`
- Delete: `bun.lock`
- Delete: `docs/SPEC.md`, `docs/TECH_STACK.md`

**Important:** Do NOT delete `docs/superpowers/` — it contains the active migration spec and plan.

- [ ] **Step 1: Remove all old directories and files**

```bash
rm -rf apps/ packages/ scripts/
rm -f turbo.json tsconfig.base.json vitest.config.ts AGENTS.md .gitattributes bun.lock
rm -rf .canopy/ .mulch/ .overstory/ .seeds/
rm -f .github/workflows/ci.yml .github/workflows/release.yml
rm -f docs/SPEC.md docs/TECH_STACK.md
```

- [ ] **Step 2: Verify only root config files remain**

```bash
ls -la
```

Expected remaining: `package.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `.gitignore`, `LICENSE`, `node_modules/`, `.git/`, `.claude/`, `.turbo/`, `docs/`

- [ ] **Step 3: Clean up node_modules**

```bash
rm -rf node_modules/ .turbo/
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove old Electron + Effect monorepo scaffold"
```

---

## Chunk 2: New Project Foundation

### Task 3: Create New package.json

**Files:**
- Rewrite: `package.json`

- [ ] **Step 1: Write new package.json**

```json
{
  "name": "emergent",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build",
    "preview": "vite preview",
    "tauri": "tauri",
    "lint": "oxlint --report-unused-disable-directives",
    "fmt": "oxfmt",
    "fmt:check": "oxfmt --check",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.10.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.11"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.10.1",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "oxlint": "^1.50.0",
    "oxfmt": "^0.35.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "typescript": "^5.7.3",
    "jsdom": "^26.0.0",
    "vite": "^7.3.1",
    "vitest": "^4.0.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
bun install
```

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add new package.json for Tauri + React project"
```

---

### Task 4: Configure TypeScript

**Files:**
- Rewrite: `tsconfig.json`

- [ ] **Step 1: Write tsconfig.json**

```json
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
    "sourceMap": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Commit**

```bash
git add tsconfig.json
git commit -m "chore: add TypeScript config with strict mode"
```

---

### Task 5: Configure Vite

**Files:**
- Create: `vite.config.ts`

- [ ] **Step 1: Write vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
```

Note: The `TAURI_DEV_HOST` env var and server config follow Tauri v2's recommended Vite setup for proper HMR in the Tauri webview.

- [ ] **Step 2: Commit**

```bash
git add vite.config.ts
git commit -m "chore: add Vite config for Tauri dev server"
```

---

### Task 6: Configure Vitest

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: Write vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: add Vitest config"
```

---

### Task 7: Update .gitignore and Linter Configs

**Files:**
- Rewrite: `.gitignore`
- Modify: `.oxlintrc.json`
- Modify: `.oxfmtrc.json`

- [ ] **Step 1: Write .gitignore**

```
node_modules/
.bun/
dist/
src-tauri/target/
.env*
*.tsbuildinfo
.DS_Store
*.log
```

- [ ] **Step 2: Update .oxlintrc.json**

Update `ignorePatterns` to remove Electron/monorepo patterns:

```json
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
    "dist/",
    "src-tauri/",
    "node_modules/",
    "bun.lock"
  ]
}
```

- [ ] **Step 3: Update .oxfmtrc.json**

```json
{
  "formatter": {
    "experimentalSortPackageJson": true
  },
  "ignorePatterns": [
    "dist/",
    "src-tauri/",
    "node_modules/",
    "bun.lock"
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore .oxlintrc.json .oxfmtrc.json
git commit -m "chore: update gitignore and linter configs for Tauri project"
```

---

## Chunk 3: React Frontend

### Task 8: Create HTML Entry and React App

**Files:**
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/index.css`
- Create: `src/vite-env.d.ts`

- [ ] **Step 1: Write index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Emergent</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write src/vite-env.d.ts**

```typescript
/// <reference types="vite/client" />
```

- [ ] **Step 3: Write src/index.css**

```css
@import "tailwindcss";
```

- [ ] **Step 4: Write src/App.tsx**

```tsx
function App() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <h1 className="text-4xl font-bold">emergent</h1>
    </div>
  );
}

export default App;
```

- [ ] **Step 5: Write src/main.tsx**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: No errors.

- [ ] **Step 7: Verify lint passes**

```bash
bun run lint
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add index.html src/
git commit -m "feat: add React frontend with Tailwind CSS"
```

---

### Task 9: Write a Frontend Unit Test

**Files:**
- Create: `src/__tests__/App.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import App from "../App";

test("renders emergent heading", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /emergent/i })).toBeDefined();
});
```

- [ ] **Step 2: Install test dependency**

```bash
bun add -d @testing-library/react
```

- [ ] **Step 3: Run test to verify it passes**

```bash
bun run test
```

Expected: 1 test passed.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/ package.json bun.lock
git commit -m "test: add App component unit test"
```

---

## Chunk 4: Tauri Backend

### Task 10: Initialize Tauri

**Files:**
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/icons/` (generated by Tauri)

- [ ] **Step 1: Initialize Tauri in the project (non-interactive)**

```bash
cd /Users/gallanoe/Documents/emergent && bunx tauri init --ci --app-name Emergent --window-title Emergent --dev-url http://localhost:1420 --frontend-dist ../dist
```

The `--ci` flag skips interactive prompts. This creates `src-tauri/` with `Cargo.toml`, `tauri.conf.json`, `src/main.rs`, `src/lib.rs`, `build.rs`, `capabilities/default.json`, and `icons/`.

- [ ] **Step 2: Rename the library crate from `app_lib` to `emergent_lib`**

`tauri init` generates `app_lib` as the default library name. Rename it:

In `src-tauri/Cargo.toml`, change the `[lib]` section:
```toml
[lib]
name = "emergent_lib"
crate-type = ["staticlib", "cdylib", "rlib"]
```

Also change `[package]` name to `emergent`:
```toml
[package]
name = "emergent"
```

- [ ] **Step 3: Update main.rs to use the renamed crate**

In `src-tauri/src/main.rs`, change `app_lib::run()` to `emergent_lib::run()`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    emergent_lib::run()
}
```

- [ ] **Step 4: Verify lib.rs has a greet command**

Read `src-tauri/src/lib.rs` — it should contain a `greet` command by default. If not, write it:

```rust
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Verify tauri.conf.json has correct settings**

Read `src-tauri/tauri.conf.json`. Key fields:
- `identifier`: should be a unique reverse-domain (e.g., `com.emergent.app`)
- `build.devUrl`: `http://localhost:1420`
- `build.frontendDist`: `../dist`

- [ ] **Step 6: Verify Rust compiles**

```bash
cd /Users/gallanoe/Documents/emergent/src-tauri && cargo check
```

Expected: Compiles successfully (first run will download crates, may take a few minutes).

- [ ] **Step 7: Commit (ensure Cargo.lock is included)**

```bash
cd /Users/gallanoe/Documents/emergent
git add src-tauri/
git commit -m "feat: initialize Tauri v2 backend with greet command"
```

Note: `src-tauri/Cargo.lock` must be committed — it is required for binary projects and is used by CI cache keys.

---

### Task 11: Verify Full Dev Loop

**Note:** Steps 1-2 require a GUI environment and must be run manually (not automatable in CI or by agentic workers).

- [ ] **Step 1: Run the dev server**

```bash
bun run dev
```

Expected: A Tauri window opens showing the "emergent" heading. The Vite dev server runs on port 1420, and the Tauri webview loads it.

- [ ] **Step 2: Verify HMR works**

Edit `src/App.tsx` — change the heading text. The window should update without a full reload.

Revert the change after verifying.

- [ ] **Step 3: Run all checks**

```bash
bun run lint && bun run typecheck && bun run test
```

Expected: All pass.

- [ ] **Step 4: Commit (if any adjustments were needed)**

```bash
git add -A
git commit -m "chore: verify dev loop and fix any issues"
```

Only commit if changes were made during verification.

---

## Chunk 5: CI/CD

### Task 12: Write CI Workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write .github/workflows/ci.yml**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-24.04

    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Install system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Cache Cargo
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            src-tauri/target
          key: ${{ runner.os }}-cargo-${{ hashFiles('src-tauri/Cargo.lock') }}
          restore-keys: |
            ${{ runner.os }}-cargo-

      - name: Cache Bun modules
        uses: actions/cache@v4
        with:
          path: node_modules
          key: ${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}
          restore-keys: |
            ${{ runner.os }}-bun-

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Lint
        run: bun run lint

      - name: Format check
        run: bun run fmt:check

      - name: Typecheck
        run: bun run typecheck

      - name: Test
        run: bun run test

      - name: Rust check
        working-directory: src-tauri
        run: cargo check
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add CI workflow for lint, typecheck, test, and Rust check"
```

---

### Task 13: Write Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write .github/workflows/release.yml**

```yaml
name: Release

on:
  push:
    tags:
      - "v*.*.*"
  workflow_dispatch:
    inputs:
      version:
        description: "Version to release (e.g., 1.0.0)"
        required: true

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  preflight:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Install system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Lint
        run: bun run lint

      - name: Format check
        run: bun run fmt:check

      - name: Typecheck
        run: bun run typecheck

      - name: Test
        run: bun run test

      - name: Rust check
        working-directory: src-tauri
        run: cargo check

  build:
    needs: preflight
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: --target aarch64-apple-darwin
          - platform: macos-latest
            args: --target x86_64-apple-darwin
          - platform: ubuntu-24.04
            args: ""
          - platform: windows-latest
            args: ""

    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Install system dependencies (Linux)
        if: matrix.platform == 'ubuntu-24.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build Tauri app
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Code signing (uncomment when ready):
          # APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          # APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          # APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          # APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
          # APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
          # APPLE_API_KEY_PATH: ${{ secrets.APPLE_API_KEY_PATH }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Emergent v__VERSION__"
          releaseBody: "See the assets to download this version and install."
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release workflow for multi-platform Tauri builds"
```

---

## Chunk 6: Final Verification

### Task 14: End-to-End Verification

- [ ] **Step 1: Clean install**

```bash
rm -rf node_modules/ src-tauri/target/
bun install --frozen-lockfile
```

- [ ] **Step 2: Run all checks**

```bash
bun run lint && bun run typecheck && bun run test
```

Expected: All pass.

- [ ] **Step 3: Verify Rust compiles**

```bash
cd /Users/gallanoe/Documents/emergent/src-tauri && cargo check
```

Expected: Compiles.

- [ ] **Step 4: Verify dev server**

```bash
cd /Users/gallanoe/Documents/emergent && bun run dev
```

Expected: Tauri window opens with "emergent" heading.

- [ ] **Step 5: Verify build (requires GUI environment)**

```bash
bun run build
```

Expected: Produces a runnable application binary in `src-tauri/target/release/bundle/`. Note: First release build compiles the full Rust binary and may take 5-15 minutes.

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "chore: final adjustments from end-to-end verification"
```

Only commit if changes were made.

---

### Task 15: Clean Up and Prepare for Merge

- [ ] **Step 1: Review git log**

```bash
git log --oneline main..HEAD
```

Verify the commit history is clean and tells the story of the migration.

- [ ] **Step 2: Verify no old artifacts remain**

```bash
ls apps/ packages/ scripts/ turbo.json tsconfig.base.json 2>&1
```

Expected: All should say "No such file or directory".

- [ ] **Step 3: Verify project structure matches spec**

```bash
ls -la src/ src-tauri/ index.html vite.config.ts vitest.config.ts tsconfig.json package.json .oxlintrc.json .oxfmtrc.json .github/workflows/
```

Expected: All files/directories exist and match the spec's project structure.
