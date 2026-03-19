# Svelte 5 Anti-Patterns & Performance

## The Ten Critical Mistakes

### 1. Using $effect to synchronize derived state

The most common mistake. If you're setting `$state` from another `$state` inside `$effect`, use `$derived`:

```js
// ❌ let doubled = $state(); $effect(() => { doubled = count * 2; });
// ✅ let doubled = $derived(count * 2);
```

`$effect` is async, skips SSR, needs cleanup, risks loops. `$derived` is sync, SSR-safe, lazy.

### 2. Circular effects

Two effects writing to each other's dependencies = infinite loops. Model one as source of truth, derive the other.

### 3. Destructuring reactive objects

```js
// ❌ let { name } = person; // snapshot, not reactive
// ✅ person.name // direct access
// ✅ let { name } = $derived(person); // reactive destructuring
```

### 4. Wrapping effects in `if (browser)`

Effects never run on the server. This guard is always redundant.

### 5. Making everything $state

Constants, config, utilities don't need reactivity. Only use `$state` for values whose changes should trigger UI updates.

### 6. Mutating props without $bindable

Mutating an object prop from a child silently fails or produces ownership warnings. Use callback props or `$bindable`.

### 7. Passing proxies to external libraries

Use `$state.snapshot()` before passing reactive state to third-party code that expects plain objects.

### 8. Using `new Set()` / `new Map()` with $state

`$state` only proxies plain objects and arrays. Use `SvelteSet`, `SvelteMap` from `svelte/reactivity`.

### 9. Expecting async reads to be tracked

Code after `await` or inside `setTimeout` runs outside tracking context. Read dependencies synchronously in the effect body.

### 10. Computing from props without $derived

```js
// ❌ let color = type === 'danger' ? 'red' : 'green'; // static snapshot
// ✅ let color = $derived(type === 'danger' ? 'red' : 'green');
```

## Performance Patterns

### Use $state.raw for large immutable data

Deep proxying has overhead proportional to size. API responses, paginated lists, and data replaced wholesale should use `$state.raw`.

### Key your {#each} blocks

```svelte
{#each items as item (item.id)}
  <Item {item} />
{/each}
```

Always key by stable identifier, **never by array index**. Keys enable surgical DOM updates.

### Extract repeated template expressions to $derived

`$derived` values are memoized — recompute only when dependencies change. Complex expressions repeated in templates waste cycles.

### Don't wrap static data in $state

Only make things reactive that need to trigger UI updates. Static config, utilities, constants should be plain `const`.
