<script lang="ts">
  interface Props {
    kind: "file" | "folder";
    depth: number;
    onconfirm: (name: string) => void;
    oncancel: () => void;
  }

  let { kind, depth, onconfirm, oncancel }: Props = $props();

  let confirmed = false;

  function doConfirm(value: string) {
    if (confirmed) return;
    confirmed = true;
    const name = value.trim();
    if (name) onconfirm(name);
    else oncancel();
  }
</script>

<div
  style="height: 28px; display: flex; align-items: center; padding-left: {depth *
    28 +
    8}px;"
>
  <!-- svelte-ignore a11y_autofocus -->
  <input
    autofocus
    placeholder={kind === "file" ? "untitled.md" : "New folder"}
    onkeydown={(e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        doConfirm(e.currentTarget.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        confirmed = true;
        oncancel();
      }
    }}
    onblur={(e) => doConfirm(e.currentTarget.value)}
    onclick={(e) => e.stopPropagation()}
    class="creation-input"
  />
</div>

<style>
  .creation-input {
    font-family: var(--font-ui);
    background: var(--color-bg-base);
    border: 1.5px solid var(--color-border-default);
    border-radius: 6px;
    font-size: 13px;
    color: var(--color-fg-default);
    padding: 0 4px;
    outline: none;
    width: 100%;
    height: 20px;
  }

  .creation-input:focus {
    border-color: var(--color-border-strong);
  }
</style>
