<script lang="ts">
  interface Props {
    command: string;
    output: string;
    exitCode: number | null;
  }

  let { command, output, exitCode }: Props = $props();

  // exit 0 uses fg-disabled to match em-tool-calls.jsx:333–334 — a zero
  // exit is silent, not celebratory. fg-muted would be too prominent.
  let exitColor = $derived(
    exitCode == null
      ? "var(--color-fg-disabled)"
      : exitCode === 0
        ? "var(--color-fg-disabled)"
        : "var(--color-error)",
  );
</script>

<div
  class="flex flex-col gap-1 font-[family-name:var(--font-mono)] text-[11.5px] leading-[1.55] text-fg-muted"
  style:padding="8px 10px 10px 32px"
>
  {#if command}
    <div class="text-fg-default">$ {command}</div>
  {/if}
  {#if output}
    <pre class="whitespace-pre-wrap break-all m-0">{output}</pre>
  {/if}
  {#if exitCode !== null}
    <div style:color={exitColor}>exit {exitCode}</div>
  {/if}
</div>
