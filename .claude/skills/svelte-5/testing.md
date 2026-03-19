# Svelte 5 Testing

## Testing Philosophy

**Test behavior, not implementation.** Before writing a component test, ask whether you're testing the component or the logic inside it. If it's the logic, extract it to a `.ts` file and test in isolation without DOM overhead.

### Three-Layer Strategy

| Layer                  | What to test                                                              | Tool                                 |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------ |
| **Pure logic**         | Extracted functions, data transforms, derived calculations                | Plain vitest (no DOM)                |
| **Component behavior** | Rendered output, user interactions, conditional rendering, prop-driven UI | `@testing-library/svelte` with jsdom |
| **E2E**                | Full user flows, native API round-trips                                   | Playwright                           |

**Invest most test budget in pure logic and component behavior.** E2E tests are slow and brittle — use them sparingly for critical paths.

### What NOT to Test

- That Svelte's reactivity system works (it does)
- Internal component state shape (test the visible result)
- Pixel-perfect styling (use visual regression if needed)
- Third-party library internals
- Trivial static rendering (a hardcoded title string is not worth a test)

### The Litmus Test

> "If this test fails, does it mean a real user-facing bug?"

If yes, keep it. If it would only fail due to a harmless refactor (renaming a CSS class, reordering markup), it's noise.

## Unit Testing Pure Logic

Extract logic from components into `.ts` files. Test without DOM overhead:

```typescript
// src/lib/chat-utils.ts
import type { DisplayMessage } from "../stores/types";

export function shouldShowTimestamp(messages: DisplayMessage[], index: number): boolean {
  if (index === 0) return true;
  const current = messages[index]!;
  const prev = messages[index - 1]!;
  if (current.role === "tool-group") return false;
  return current.timestamp !== prev.timestamp;
}
```

```typescript
// src/lib/chat-utils.test.ts
import { describe, it, expect } from "vitest";
import { shouldShowTimestamp } from "./chat-utils";

describe("shouldShowTimestamp", () => {
  it("always shows timestamp for the first message", () => {
    expect(shouldShowTimestamp([msg("user", "1:00 PM")], 0)).toBe(true);
  });
  it("hides timestamp when same as previous", () => {
    const messages = [msg("assistant", "1:00 PM"), msg("assistant", "1:00 PM")];
    expect(shouldShowTimestamp(messages, 1)).toBe(false);
  });
});
```

**Use factory functions** for test data — keep tests readable, override only what matters:

```typescript
function makeSwarm(overrides?: Partial<DisplaySwarm>): DisplaySwarm {
  return { id: "swarm-1", name: "test-swarm", collapsed: false, agents: [], ...overrides };
}
```

### Testing Runes in .svelte.ts Files

Runes only work in `.svelte` or `.svelte.ts` files. Name your module accordingly:

```typescript
// src/lib/counter.svelte.ts
export function createCounter(initial = 0) {
  let count = $state(initial);
  return {
    get count() {
      return count;
    },
    increment() {
      count += 1;
    },
  };
}
```

Test by importing and exercising the public API. Use `flushSync` after mutations:

```typescript
// src/lib/counter.svelte.test.ts
import { flushSync } from "svelte";
import { createCounter } from "./counter.svelte.ts";

test("increments", () => {
  const counter = createCounter(0);
  counter.increment();
  flushSync();
  expect(counter.count).toBe(1);
});
```

### Testing $effect

Wrap in `$effect.root` and use `flushSync`:

```typescript
import { flushSync } from "svelte";

test("effect tracks changes", () => {
  const log: number[] = [];
  const cleanup = $effect.root(() => {
    let count = $state(0);
    $effect(() => {
      log.push(count);
    });

    flushSync();
    expect(log).toEqual([0]);

    count = 1;
    flushSync();
    expect(log).toEqual([0, 1]);
  });
  cleanup(); // always clean up effect roots
});
```

## Component Testing

### Setup

```typescript
import { render, screen, cleanup } from "@testing-library/svelte";
import { afterEach, describe, it, expect } from "vitest";
import Component from "./Component.svelte";

describe("Component", () => {
  afterEach(() => cleanup());

  it("renders content", () => {
    render(Component, { props: { label: "Hello" } });
    expect(screen.getByText("Hello")).toBeTruthy();
  });
});
```

Alternatively, add the `svelteTesting` plugin to vitest config for automatic cleanup (eliminates manual `afterEach`):

```typescript
// vitest.config.ts
import { svelteTesting } from "@testing-library/svelte/vite";
plugins: [svelte(), svelteTesting()];
```

### Query Priority

Use the most accessible query available:

1. `getByRole` — most resilient to markup changes
2. `getByLabelText` — for form fields
3. `getByText` — for visible text content
4. `getByTestId` — last resort

Use `queryBy*` to assert absence:

```typescript
expect(screen.queryByText("Hidden content")).toBeNull();
```

Use `findBy*` for async content (auto-waits):

```typescript
const result = await screen.findByText("Loaded");
```

### User Interactions

**Prefer `userEvent` over `fireEvent`.** `userEvent` simulates complete interactions (focus, keydown, keyup, input, blur). `fireEvent` dispatches a single synthetic event.

```typescript
import userEvent from "@testing-library/user-event";

it("handles click", async () => {
  const user = userEvent.setup();
  render(Button, { props: { label: "Click me" } });
  await user.click(screen.getByRole("button", { name: "Click me" }));
  expect(screen.getByText("Clicked!")).toBeTruthy();
});
```

Use `fireEvent` only for low-level edge cases:

```typescript
await fireEvent.keyDown(element, { key: "Escape" });
```

### Testing Callback Props (Svelte 5 Events)

Svelte 5 uses callback props instead of `createEventDispatcher`. Test directly:

```typescript
it("calls onSelectAgent when clicking an agent", async () => {
  const onSelectAgent = vi.fn();
  render(Sidebar, {
    props: { onSelectAgent /* ...other props */ },
  });
  await fireEvent.click(screen.getByText("Fix navigation bug"));
  expect(onSelectAgent).toHaveBeenCalledWith("agent-1");
});
```

### Testing Conditional Rendering

Test both sides of every condition:

```typescript
it("hides agents when collapsed", () => {
  render(Sidebar, { props: { swarms: [makeSwarm({ collapsed: true })] } });
  expect(screen.queryByText("Fix navigation bug")).toBeNull();
});

it("shows agents when expanded", () => {
  render(Sidebar, { props: { swarms: [makeSwarm({ collapsed: false })] } });
  expect(screen.getByText("Fix navigation bug")).toBeTruthy();
});
```

### Testing Snippets

Use `createRawSnippet` from `svelte`:

```typescript
import { createRawSnippet } from "svelte";

const children = createRawSnippet(() => ({
  render: () => `<span>Click me</span>`,
}));

render(MyButton, { props: { children } });
```

For snippets needing interactivity, use the `setup` callback:

```typescript
const children = createRawSnippet(() => ({
  render: () => `<div></div>`,
  setup: (target) => {
    const comp = mount(InnerComponent, {
      target,
      props: {
        /* ... */
      },
    });
    return () => unmount(comp);
  },
}));
```

## Vitest Configuration for Svelte 5

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    conditions: ["browser"], // CRITICAL: prevents server-side bundle resolution in jsdom
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

**`resolve.conditions: ["browser"]` is mandatory.** Without it, Vitest resolves Svelte's server-side entry points in jsdom, causing `lifecycle_function_unavailable` errors like `mount(...) is not available on the server`.

## Mocking Native APIs

### Tauri IPC

Mock `__TAURI_INTERNALS__` in your test setup so components importing `@tauri-apps` can load:

```typescript
// src/test-setup.ts
(globalThis as any).__TAURI_INTERNALS__ = {
  invoke: (_cmd: string, _args?: unknown) => Promise.resolve(null),
  transformCallback: (cb: Function) => {
    const id = ++callbackId;
    callbacks[id] = cb;
    return id;
  },
  unregisterCallback: (id: number) => {
    delete callbacks[id];
  },
  callbacks,
};

(globalThis as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: () => {},
};
```

For targeted command mocking, use `@tauri-apps/api/mocks`:

```typescript
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";

afterEach(() => clearMocks());

test("mocked Tauri command", async () => {
  mockIPC((cmd) => {
    if (cmd === "read_file") return "file contents";
  });
  const result = await invoke("read_file", { path: "/tmp/test" });
  expect(result).toBe("file contents");
});
```

### jsdom Missing APIs

jsdom lacks several browser APIs. Mock in `test-setup.ts` if your components use them:

- `window.matchMedia` — mock if using media queries
- `ResizeObserver` — mock if used for layout
- `IntersectionObserver` — mock if used for lazy loading
- `window.prompt()` / `window.confirm()` — do not work in Tauri WebView either

## Common Pitfalls

### DOM not cleaned between tests

Multiple renders accumulate in jsdom. Always clean up via `afterEach(() => cleanup())` or the `svelteTesting` plugin. Symptoms: "Found multiple elements" errors, tests passing individually but failing together.

### Server-side module resolution

Without `resolve.conditions: ["browser"]` in vitest config, Svelte resolves to SSR bundles. Symptoms: `mount(...) is not available on the server`, `lifecycle_function_unavailable`.

### Runes in plain .ts files

`$state`, `$derived`, `$effect` are compiler directives — they silently do nothing in plain `.ts` files. Name reactive modules `*.svelte.ts` and their tests `*.svelte.test.ts`.

### Snapshot overuse

Snapshot tests of component markup are brittle and rarely catch real bugs. They break on any markup change. Prefer explicit assertions on visible behavior.

## Test Organization

Group by behavior, not by method:

```typescript
describe("Sidebar", () => {
  describe("rendering", () => {
    /* static output tests */
  });
  describe("interactions", () => {
    /* click/type tests */
  });
  describe("edge cases", () => {
    /* empty data, error states */
  });
});
```

### High-Value Test Targets

- **Pure logic with edge cases** — boundary conditions, off-by-ones, empty states
- **Conditional rendering driven by props** — collapsed/expanded, demo/live modes
- **User interaction contracts** — clicking fires callbacks with correct arguments
- **Async state transitions** — loading/error/success states

### Low-Value Test Targets

- Static strings that never change
- CSS class presence (unless driving conditional behavior)
- Framework reactivity internals
- Exact DOM structure (test what the user sees, not how it's structured)
