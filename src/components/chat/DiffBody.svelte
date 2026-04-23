<script lang="ts">
  interface Props {
    oldText: string | null | undefined;
    newText: string;
  }

  let { oldText, newText }: Props = $props();

  type Row = { kind: "removed" | "added"; text: string; lineno: number };

  // ACP provides oldText and newText as whole strings with no hunks, so
  // this is a concatenated before/after view, not a traditional side-by-
  // side diff. Line numbers restart at 1 for each side. Matches the flat
  // list presentation in em-tool-calls.jsx:297-319.
  let rows = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    if (oldText != null && oldText !== "") {
      oldText.split("\n").forEach((text, i) => {
        out.push({ kind: "removed", text, lineno: i + 1 });
      });
    }
    if (newText !== "") {
      newText.split("\n").forEach((text, i) => {
        out.push({ kind: "added", text, lineno: i + 1 });
      });
    }
    return out;
  });
</script>

<div
  class="font-[family-name:var(--font-mono)] text-[10.5px] leading-[1.55]"
  style:padding="8px 10px 10px 32px"
>
  {#each rows as row (row.kind + ":" + row.lineno)}
    <div
      data-diff-kind={row.kind}
      class="grid items-start"
      style:grid-template-columns="34px 14px 1fr"
      style:background={row.kind === "added"
        ? "color-mix(in oklab, var(--color-added-fg) 10%, transparent)"
        : "color-mix(in oklab, var(--color-removed-fg) 10%, transparent)"}
      style:color={row.kind === "added"
        ? "var(--color-added-fg)"
        : "var(--color-removed-fg)"}
    >
      <span
        data-diff-lineno
        class="text-right pr-2 text-fg-disabled select-none"
        style:opacity="0.7"
      >
        {row.lineno}
      </span>
      <span data-diff-sign class="text-center select-none">
        {row.kind === "added" ? "+" : "-"}
      </span>
      <span class="whitespace-pre-wrap break-all">{row.text}</span>
    </div>
  {/each}
</div>
