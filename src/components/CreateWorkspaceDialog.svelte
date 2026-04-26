<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { Button, Input } from "../lib/primitives";

  interface Props {
    onConfirm: (name: string) => void;
    onCancel: () => void;
  }

  let { onConfirm, onCancel }: Props = $props();

  let name = $state("");
  let inputHost: HTMLDivElement | undefined = $state();

  function handleSubmit() {
    const trimmed = name.trim();
    if (trimmed) onConfirm(trimmed);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && name.trim()) {
      e.preventDefault();
      handleSubmit();
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeydown);
    void tick().then(() => {
      inputHost?.querySelector("input")?.focus();
    });
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeydown);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-[100] flex items-center justify-center bg-black/25"
  onclick={(e) => {
    if (e.target === e.currentTarget) onCancel();
  }}
  onkeydown={() => {}}
>
  <div
    class="w-[340px] rounded-[12px] border border-border-strong bg-bg-elevated p-[18px] shadow-[var(--shadow-lg)]"
    data-testid="create-workspace-dialog"
  >
    <h2 class="mb-3 text-[14px] font-semibold text-fg-heading">
      Create Workspace
    </h2>
    <label
      class="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-fg-muted"
    >
      Workspace Name
      <div bind:this={inputHost} class="mt-1.5">
        <Input bind:value={name} placeholder="my-project" size="md" />
      </div>
    </label>
    <div class="mt-4 flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={onCancel}>
        {#snippet children()}Cancel{/snippet}
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={!name.trim()}
        onclick={handleSubmit}
      >
        {#snippet children()}Create{/snippet}
      </Button>
    </div>
  </div>
</div>
