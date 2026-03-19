# Svelte 5 Component Patterns

## $props — The Single Entry Point

`$props()` replaces `export let`. Use standard destructuring for defaults, renaming, and rest:

```svelte
<script lang="ts">
  interface Props {
    title: string;
    count?: number;
    onclick?: (e: MouseEvent) => void;
    children?: import('svelte').Snippet;
    [key: string]: unknown; // enables rest/spread
  }

  let { title, count = 0, onclick, children, ...rest }: Props = $props();
</script>
```

For wrapper components forwarding native attributes:

```svelte
<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  let { children, ...rest }: HTMLButtonAttributes = $props();
</script>
<button {...rest}>{@render children?.()}</button>
```

**Rules:**
- Props are reactive — they update when the parent changes them
- Never mutate prop objects directly — use callbacks or `$bindable`
- `$props.id()` (v5.20+) generates hydration-safe unique IDs

### $bindable — Two-Way Binding

```svelte
<!-- FancyInput.svelte -->
<script>
  let { value = $bindable(), ...props } = $props();
</script>
<input bind:value={value} {...props} />

<!-- Parent: <FancyInput bind:value={message} /> -->
```

Use sparingly — overuse makes data flow unpredictable.

## Snippets Replace Slots

Slots are deprecated. Use `{#snippet}` and `{@render}`:

```svelte
{#snippet greeting(name)}
  <p>Hello {name}!</p>
{/snippet}

{@render greeting('Alice')}
```

### Passing Snippets to Components

**Implicit** — declare inside component tags (becomes a prop automatically):

```svelte
<Table data={items}>
  {#snippet row(item)}
    <td>{item.name}</td><td>{item.price}</td>
  {/snippet}
</Table>
```

**Explicit** — declare outside and pass as prop:

```svelte
{#snippet row(item)}
  <td>{item.name}</td><td>{item.price}</td>
{/snippet}

<Table data={items} {row} />
```

### The children Snippet

Non-snippet content inside component tags becomes `children`:

```svelte
<!-- Parent -->
<Button>Click me</Button>

<!-- Button.svelte -->
<script>
  let { children } = $props();
</script>
<button>{@render children?.()}</button>
```

Use `children?.()` or `{#if children}` with fallback for optional children.

## Event Handling

### DOM Events

Standard HTML attributes without colon: `onclick`, `onkeydown`, `onsubmit`.

Event modifiers (`|preventDefault|once`) are gone. Handle explicitly:

```svelte
<button onclick={(e) => { e.preventDefault(); handle(e); }}>
```

For `capture`, append to event name: `onclickcapture={handler}`.

### Component Events — Callback Props

`createEventDispatcher` is deprecated. Use function props:

```svelte
<script>
  let { onincrement, ondecrement } = $props();
</script>
<button onclick={ondecrement}>-</button>
<button onclick={onincrement}>+</button>
```

Combine multiple handlers inline (no duplicate attributes allowed):

```svelte
<button onclick={(e) => { track(e); handle(e); }}>
```

## TypeScript

### Typing Snippets

```ts
import type { Snippet } from 'svelte';

interface Props {
  header: Snippet;
  row: Snippet<[{ name: string; price: number }]>;
  children?: Snippet;
}
```

### Generic Components

```svelte
<script lang="ts" generics="T extends { id: string }">
  import type { Snippet } from 'svelte';

  let { data, row }: {
    data: T[];
    row: Snippet<[T]>;
  } = $props();
</script>

{#each data as item (item.id)}
  {@render row(item)}
{/each}
```

### Component Type

Use `Component` (not legacy `SvelteComponent`):

```ts
import type { Component, ComponentProps } from 'svelte';
type MyProps = ComponentProps<typeof MyComp>;
```
