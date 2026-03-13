<script lang="ts">
  interface Props {
    defaultValue: string;
    isFile: boolean;
    onconfirm: (newName: string) => void;
    oncancel: () => void;
  }

  let { defaultValue, isFile, onconfirm, oncancel }: Props = $props();

  let inputEl: HTMLInputElement | undefined = $state();
  let confirmed = false;

  function doConfirm(value: string) {
    if (confirmed) return;
    confirmed = true;
    onconfirm(value);
  }

  $effect(() => {
    if (!inputEl) return;
    inputEl.focus();
    if (isFile) {
      const dotIdx = defaultValue.lastIndexOf(".");
      if (dotIdx > 0) {
        inputEl.setSelectionRange(0, dotIdx);
      } else {
        inputEl.select();
      }
    } else {
      inputEl.select();
    }
  });
</script>

<input
  bind:this={inputEl}
  value={defaultValue}
  onkeydown={(e) => {
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); doConfirm(e.currentTarget.value); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); confirmed = true; oncancel(); }
  }}
  onblur={(e) => doConfirm(e.currentTarget.value)}
  onclick={(e) => e.stopPropagation()}
  ondblclick={(e) => e.stopPropagation()}
  style="background: var(--color-bg-base); border: 1px solid var(--color-accent); border-radius: 4px; font-size: 13px; color: var(--color-fg-default); padding: 0 4px; outline: none; width: 100%; height: 20px;"
/>
