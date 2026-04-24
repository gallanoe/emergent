<script lang="ts">
  import type { ToolKind } from "../../stores/types";

  interface Props {
    kind: ToolKind;
    size?: number;
    class?: string;
  }

  let { kind, size = 12, class: klass = "" }: Props = $props();
</script>

<!--
  Inline 12×12 verb icons. Hand-drawn style from
  docs/design/v2/project/em-tool-calls.jsx (lines 66-140). Stroke uses
  currentColor so the icon inherits whatever foreground the caller sets.
-->
{#if kind === "read"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    class={klass}
    aria-hidden="true"
  >
    <path
      d="M3 3h7l3 3v7H3z"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linejoin="round"
    />
    <path
      d="M10 3v3h3"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linejoin="round"
    />
  </svg>
{:else if kind === "edit"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    class={klass}
    aria-hidden="true"
  >
    <path
      d="M10.5 2.5l3 3L6 13l-3.5.5.5-3.5z"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linejoin="round"
    />
  </svg>
{:else if kind === "search"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    class={klass}
    aria-hidden="true"
  >
    <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.25" />
    <path
      d="M10.5 10.5L14 14"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
    />
  </svg>
{:else if kind === "execute"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    class={klass}
    aria-hidden="true"
  >
    <rect
      x="1.5"
      y="3"
      width="13"
      height="10"
      rx="1.5"
      stroke="currentColor"
      stroke-width="1.25"
    />
    <path
      d="M4 6l2 2-2 2M8 10h4"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
{:else if kind === "fetch"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    class={klass}
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.25" />
    <path
      d="M2.5 8h11M8 2.5c2 2 2 9 0 11M8 2.5c-2 2-2 9 0 11"
      stroke="currentColor"
      stroke-width="1.1"
    />
  </svg>
{:else if kind === "think"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    class={klass}
    aria-hidden="true"
  >
    <path
      d="M8 2.2c-1.7 0-3 1.2-3.1 2.7-.9.2-1.6 1-1.6 1.9 0 .6.3 1.1.7 1.4-.3.3-.5.7-.5 1.2 0 .8.6 1.5 1.3 1.6.1 1.2 1.1 2.2 2.4 2.2.7 0 1.3-.3 1.7-.8.4.5 1 .8 1.7.8 1.3 0 2.3-1 2.4-2.2.7-.1 1.3-.8 1.3-1.6 0-.5-.2-.9-.5-1.2.4-.3.7-.8.7-1.4 0-.9-.7-1.7-1.6-1.9C11 3.4 9.7 2.2 8 2.2z"
      stroke="currentColor"
      stroke-width="1.1"
      stroke-linejoin="round"
    />
    <path
      d="M8 2.2v11.2M5.5 6.8c.5.3 1.1.4 1.6.3M10.5 6.8c-.5.3-1.1.4-1.6.3M6 10c.6.2 1.3.2 1.9 0M10 10c-.6.2-1.3.2-1.9 0"
      stroke="currentColor"
      stroke-width="0.9"
      stroke-linecap="round"
    />
  </svg>
{:else if kind === "delete"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    class={klass}
    aria-hidden="true"
  >
    <path
      d="M3.5 4.5h9M6 4.5V3h4v1.5M4.5 4.5l.6 8.2a1 1 0 001 .9h3.8a1 1 0 001-.9l.6-8.2"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
{:else if kind === "move"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    class={klass}
    aria-hidden="true"
  >
    <path
      d="M3 5h8M9 3l2 2-2 2M13 11H5M7 9l-2 2 2 2"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
{:else}
  <!-- "other" / fallback: a small wrench-like dot-trio -->
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    class={klass}
    aria-hidden="true"
  >
    <rect
      x="2.5"
      y="2.5"
      width="11"
      height="11"
      rx="2"
      stroke="currentColor"
      stroke-width="1.25"
    />
    <circle cx="5.5" cy="8" r="0.9" fill="currentColor" />
    <circle cx="8" cy="8" r="0.9" fill="currentColor" />
    <circle cx="10.5" cy="8" r="0.9" fill="currentColor" />
  </svg>
{/if}
