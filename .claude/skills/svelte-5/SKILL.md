---
name: svelte-5
description: Use when writing, creating, modifying, reviewing, debugging, testing, or optimizing Svelte 5 code — covers runes, component patterns, state management, testing, and anti-patterns
---

# Svelte 5 Guidelines

This skill is split into focused sub-files. **Read only the files relevant to your current task** to keep context lean.

## Sub-File Directory

| File                  | Load when...                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `runes.md`            | Writing reactive state (`$state`), computed values (`$derived`), side effects (`$effect`), or reactive classes         |
| `components.md`       | Creating/modifying component interfaces: `$props`, `$bindable`, snippets, callback events, TypeScript typing, generics |
| `state-management.md` | Sharing state across components, setting up `.svelte.ts` modules, working with SvelteKit SSR/context                   |
| `testing.md`          | Writing unit tests, component tests, vitest setup, mocking native APIs, Svelte 5 testing patterns                      |
| `anti-patterns.md`    | Reviewing, debugging, or optimizing — the 10 critical mistakes and performance patterns                                |

## How to Use

1. Identify which sub-files match your task from the table above
2. Use the Read tool to load the relevant file(s) from this skill's directory
3. Load multiple files if your task spans concerns (e.g. creating a component with shared state → `components.md` + `state-management.md`)

## Universal Rules (always apply)

- Runes (`$state`, `$derived`, `$effect`, `$props`) are **compiler directives**, not functions — never import them
- Runes only work in `.svelte`, `.svelte.js`, and `.svelte.ts` files
- **Prefer `$derived` over `$effect`** for any value computed from other state
- `$effect` is an escape hatch — try `$derived`, template expressions, and event handlers first
- Slots are deprecated — use snippets (`{#snippet}` / `{@render}`)
- `createEventDispatcher` is deprecated — use callback props
- `export let` is deprecated — use `$props()`
