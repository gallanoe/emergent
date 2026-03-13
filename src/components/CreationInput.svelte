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
  style="height: 28px; display: flex; align-items: center; padding-left: {depth * 16 + 8}px; border-left: 2px solid var(--color-accent);"
>
  <input
    autofocus
    placeholder={kind === "file" ? "untitled.md" : "New folder"}
    onkeydown={(e) => {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); doConfirm(e.currentTarget.value); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); confirmed = true; oncancel(); }
    }}
    onblur={(e) => doConfirm(e.currentTarget.value)}
    onclick={(e) => e.stopPropagation()}
    style="background: var(--color-bg-base); border: 1px solid var(--color-accent); border-radius: 4px; font-size: 13px; color: var(--color-fg-default); padding: 0 4px; outline: none; width: 100%; height: 20px;"
  />
</div>
