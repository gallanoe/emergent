<!-- src/components/Toast.svelte -->
<script lang="ts">
  import { toastStore } from "../stores/toast.svelte";

  const TYPE_COLORS: Record<string, string> = {
    success: "var(--color-success)",
    error: "var(--color-error)",
    info: "var(--color-accent)",
  };
</script>

{#if toastStore.toasts.length > 0}
  <div
    style="position: fixed; bottom: 32px; right: 16px; z-index: 1000; display: flex; flex-direction: column; gap: 8px;"
  >
    {#each toastStore.toasts as toast (toast.id)}
      <div
        style="background: var(--color-bg-active); border: 1px solid var(--color-border-default); border-left: 3px solid {TYPE_COLORS[
          toast.type
        ]}; border-radius: 4px; padding: 8px 12px; font-size: 13px; color: var(--color-fg-default); display: flex; align-items: center; gap: 8px; max-width: 360px; animation: toast-in 150ms ease-out;"
      >
        <span style="flex: 1;">{toast.message}</span>
        {#if toast.action}
          <button
            onclick={() => {
              toast.action!.onClick();
              toastStore.removeToast(toast.id);
            }}
            class="interactive"
            style="background: none; border: none; color: var(--color-accent-text); font-size: 12px; padding: 2px 6px;"
          >
            {toast.action.label}
          </button>
        {/if}
        <span
          role="button"
          tabindex="0"
          onclick={() => toastStore.removeToast(toast.id)}
          onkeydown={(e) => {
            if (e.key === "Enter") toastStore.removeToast(toast.id);
          }}
          class="interactive"
          style="color: var(--color-fg-muted); font-size: 10px;"
        >
          ×
        </span>
      </div>
    {/each}
  </div>
{/if}
