<script lang="ts">
  interface Props {
    command?: string;
    rawInput?: unknown;
    output: string;
    exitCode: number | null;
  }

  let { command, rawInput, output, exitCode }: Props = $props();

  // Agents encode the shell command under a variety of keys depending on
  // the tool definition (bash, execute_command, run_script, …). Callers
  // can pass the explicit `command` string, or pass `rawInput` through
  // and let us pick the best shape. Order matters: the explicit prop
  // wins, then common aliases, then `args` joined if it looks like argv.
  function resolveCommand(explicit: string | undefined, raw: unknown): string {
    if (typeof explicit === "string" && explicit.length > 0) return explicit;
    if (!raw || typeof raw !== "object") return "";
    const obj = raw as Record<string, unknown>;
    const keys = ["command", "cmd", "script", "input", "bash"] as const;
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
    if (
      Array.isArray(obj.args) &&
      obj.args.every((a) => typeof a === "string")
    ) {
      return (obj.args as string[]).join(" ");
    }
    return "";
  }

  let resolvedCommand = $derived(resolveCommand(command, rawInput));

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
  {#if resolvedCommand}
    <div class="text-fg-default">$ {resolvedCommand}</div>
  {/if}
  {#if output}
    <pre class="whitespace-pre-wrap break-all m-0">{output}</pre>
  {/if}
  {#if exitCode !== null}
    <div style:color={exitColor}>exit {exitCode}</div>
  {/if}
</div>
