# Svelte 5 Runes Reference

Runes are **compiler directives** (not functions). Never import them. They only work in `.svelte`, `.svelte.js`, and `.svelte.ts` files.

## Quick Reference

| Rune | Purpose | Triggers update on |
|------|---------|-------------------|
| `$state(value)` | Reactive state | Reassignment; mutation (deep proxy for objects/arrays) |
| `$state.raw(value)` | Shallow reactive state | Reassignment only (no proxy) |
| `$state.snapshot(proxy)` | Static deep copy | N/A — returns plain object |
| `$derived(expr)` | Computed value | Dependencies change (lazy, memoized) |
| `$derived.by(() => { ... })` | Multi-statement computed | Same as `$derived` |
| `$effect(() => { ... })` | Side effect (escape hatch) | Synchronously-read dependencies change |
| `$effect.pre(() => { ... })` | Pre-DOM-update effect | Same, runs before DOM updates |
| `$inspect(value)` | Dev-only reactive log | Dependencies change (no-op in prod) |

## $state — Deep Reactivity Rules

Deep proxy applies to **plain objects and arrays only**. These are NOT proxied:
- Class instances
- `Map`, `Set`, `Date`, `URL`
- Objects via `Object.create()`

For collections, use `SvelteMap`, `SvelteSet`, `SvelteDate`, `SvelteURL` from `svelte/reactivity`.

### When to use $state.raw

Use for data you **replace wholesale, never mutate property-by-property**:
- API responses, paginated data, large datasets, data from external libraries

```js
let data = $state.raw([]);
// ✅ Replace entirely
data = await fetchItems();
// ❌ Mutation is silently ignored
data.push(item);
```

### $state.snapshot

Use before passing reactive state to code that doesn't expect `Proxy`:
- `structuredClone`, Web Workers, `postMessage`, third-party libraries

## $derived — Your Primary Tool

**Always prefer $derived over $effect for computed values.** `$derived` is synchronous, SSR-compatible, lazy, and memoized. `$effect` is async, skipped during SSR, and requires cleanup.

```js
let count = $state(0);
let doubled = $derived(count * 2);
let total = $derived.by(() => {
  let sum = 0;
  for (const n of numbers) sum += n;
  return sum;
});
```

Destructuring a `$derived` produces individually reactive variables:

```js
let { a, b } = $derived(computeValues());
```

Since Svelte 5.25, `let`-declared derived values can be temporarily overridden (optimistic UI).

## $effect — The Escape Hatch

Use ONLY for: canvas drawing, third-party library integration, analytics, subscriptions, DOM measurement.

**Before reaching for $effect, try in order:**
1. `$derived` — computed values
2. Template expressions — `style:color={color}`
3. Event handlers — user-triggered logic
4. `<svelte:window>` / `<svelte:document>` — global listeners
5. `$inspect` — debugging

### Dependency tracking rules

- Only values read **synchronously** during execution are tracked
- Code after `await` or inside `setTimeout` is NOT tracked
- Conditional branches only track values read in the branch that executed

### Cleanup pattern

```js
$effect(() => {
  const interval = setInterval(() => count += 1, ms);
  return () => clearInterval(interval);
});
```

## Reactive Classes

Class instances aren't proxied. Use `$state` on individual fields:

```js
class Todo {
  done = $state(false);
  text = $state('');

  constructor(text) { this.text = text; }

  // Arrow function preserves `this` in event handlers
  reset = () => { this.text = ''; this.done = false; };
}
```

**Gotcha:** `$state` fields become non-enumerable get/set pairs. Use `$state.snapshot()` for serialization.

**Gotcha:** `onclick={todo.reset}` loses `this` if `reset` is a regular method. Use arrow functions or `onclick={() => todo.reset()}`.
