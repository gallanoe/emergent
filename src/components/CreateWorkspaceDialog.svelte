<script lang="ts">
  import { onMount, onDestroy } from "svelte";

  interface Props {
    onConfirm: (name: string) => void;
    onCancel: () => void;
  }

  let { onConfirm, onCancel }: Props = $props();

  let name = $state("");
  let inputEl: HTMLInputElement | undefined = $state();

  function handleSubmit() {
    const trimmed = name.trim();
    if (trimmed) onConfirm(trimmed);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onCancel();
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeydown);
    inputEl?.focus();
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeydown);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 bg-black/25 flex items-center justify-center z-[100]"
  onclick={(e) => {
    if (e.target === e.currentTarget) onCancel();
  }}
  onkeydown={() => {}}
>
  <div
    class="bg-bg-elevated rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.15),0_2px_8px_rgba(0,0,0,0.08)] w-[340px]"
  >
    <div class="p-5 pb-4">
      <h2 class="text-[14px] font-semibold text-fg-heading mb-3">
        Create Workspace
      </h2>
      <label
        class="block text-[10px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
        >Workspace Name</label
      >
      <input
        bind:this={inputEl}
        bind:value={name}
        class="w-full bg-bg-base border border-border-strong rounded-md px-3 py-1.5 text-[13px] text-fg-default focus:outline-none focus:border-border-focus"
        placeholder="my-project"
        onkeydown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
      />
    </div>
    <div class="flex justify-end gap-2 px-5 pb-4">
      <button
        class="interactive h-7 px-3.5 rounded-[5px] text-[12px] font-medium text-fg-default bg-bg-elevated border border-border-strong"
        onclick={onCancel}
      >
        Cancel
      </button>
      <button
        class="h-7 px-3.5 rounded-[5px] text-[12px] font-medium text-bg-base bg-accent hover:bg-accent-hover transition-colors duration-100 {!name.trim()
          ? 'opacity-50 pointer-events-none'
          : ''}"
        disabled={!name.trim()}
        onclick={handleSubmit}
      >
        Create
      </button>
    </div>
  </div>
</div>
