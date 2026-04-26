<script lang="ts">
  import Button from "./Button.svelte";

  interface Props {
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel?: string;
    confirmVariant?: "primary" | "danger";
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
  }

  let {
    title,
    description,
    confirmLabel,
    cancelLabel = "Cancel",
    confirmVariant = "primary",
    onConfirm,
    onCancel,
  }: Props = $props();

  let confirmed = $state(false);

  async function handleConfirm() {
    if (confirmed) return;
    confirmed = true;
    await onConfirm();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter") {
      e.preventDefault();
      void handleConfirm();
    }
  }

  $effect(() => {
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
  data-testid="confirm-overlay"
  onclick={(e) => {
    if (e.target === e.currentTarget) onCancel();
  }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    class="max-w-[400px] rounded-[12px] border border-border-strong bg-bg-elevated p-[18px] shadow-[var(--shadow-lg)]"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
  >
    <h2 class="text-[13px] font-semibold text-fg-heading">{title}</h2>
    <p class="mt-1 text-[12px] leading-[1.55] text-fg-muted">{description}</p>
    <!-- prettier-ignore -->
    <div class="mt-4 flex justify-end gap-2">
      <!-- prettier-ignore -->
      <Button variant="ghost" size="sm" onclick={onCancel}>{cancelLabel}</Button>
      <!-- prettier-ignore -->
      <Button variant={confirmVariant === "danger" ? "danger" : "primary"} size="sm" disabled={confirmed} onclick={() => void handleConfirm()}>{confirmLabel}</Button>
    </div>
  </div>
</div>
