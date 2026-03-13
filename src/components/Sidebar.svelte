<script lang="ts">
  import FileTree from "./FileTree.svelte";

  interface Props {
    width: number;
    onwidthchange: (width: number) => void;
  }

  let { width, onwidthchange }: Props = $props();

  function handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const rawWidth = startWidth + moveEvent.clientX - startX;
      if (rawWidth < 120) {
        onwidthchange(0);
      } else {
        onwidthchange(Math.max(180, Math.min(400, rawWidth)));
      }
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }
</script>

<div
  class="relative flex flex-col overflow-hidden"
  style="width: {width}px; min-width: 180px; max-width: 400px; border-right: 1px solid var(--color-border-default);"
>
  <div
    class="flex items-center justify-between px-3 py-2"
    style="font-size: 11px; border-bottom: 1px solid var(--color-border-default);"
  >
    <span
      style="color: var(--color-fg-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;"
    >
      Files
    </span>
  </div>
  <div class="flex-1 overflow-y-auto py-1">
    <FileTree />
  </div>
  <div
    role="separator"
    tabindex={-1}
    onmousedown={handleMouseDown}
    ondblclick={() => onwidthchange(220)}
    style="position: absolute; top: 0; right: -4px; bottom: 0; width: 8px; cursor: col-resize; z-index: 10;"
  ></div>
</div>
