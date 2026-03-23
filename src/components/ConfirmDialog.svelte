<!-- src/components/ConfirmDialog.svelte -->
<script lang="ts">
  import { Power } from "@lucide/svelte";
  import { onMount, onDestroy } from "svelte";

  interface Props {
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
  }

  let { title, description, confirmLabel, onConfirm, onCancel }: Props =
    $props();

  let confirmed = $state(false);

  function handleConfirm() {
    if (confirmed) return;
    confirmed = true;
    onConfirm();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onCancel();
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeydown);
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeydown);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 bg-black/25 flex items-center justify-center z-[100]"
  data-testid="confirm-overlay"
  onclick={(e) => {
    if (e.target === e.currentTarget) onCancel();
  }}
  onkeydown={() => {}}
>
  <div
    class="bg-white rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.15),0_2px_8px_rgba(0,0,0,0.08)] w-[340px]"
  >
    <div class="p-5 pb-4">
      <div class="flex items-center gap-2.5 mb-2">
        <div
          class="w-7 h-7 rounded-full bg-error/8 flex items-center justify-center text-error shrink-0"
        >
          <Power size={15} />
        </div>
        <h2 class="text-[14px] font-semibold text-fg-heading">{title}</h2>
      </div>
      <p class="text-[12px] text-fg-muted leading-relaxed">{description}</p>
    </div>
    <div class="flex justify-end gap-2 px-5 pb-4">
      <button
        class="interactive h-7 px-3.5 rounded-[5px] text-[12px] font-medium text-fg-default bg-white border border-border-strong"
        onclick={onCancel}
      >
        Cancel
      </button>
      <button
        class="h-7 px-3.5 rounded-[5px] text-[12px] font-medium text-white bg-error hover:bg-[#b33535] transition-colors duration-100
          {confirmed ? 'opacity-50 pointer-events-none' : ''}"
        onclick={handleConfirm}
        disabled={confirmed}
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</div>
