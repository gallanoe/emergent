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
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- Linter false positive: a focusable separator (tabindex=0) is interactive per WAI-ARIA spec -->
  <div
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize sidebar"
    aria-valuenow={width}
    aria-valuemin={180}
    aria-valuemax={400}
    tabindex={0}
    onmousedown={handleMouseDown}
    ondblclick={() => onwidthchange(220)}
    onkeydown={(e) => {
      const step = e.shiftKey ? 40 : 10;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const next = width - step;
        onwidthchange(next < 120 ? 0 : Math.max(180, next));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onwidthchange(Math.min(400, width + step));
      } else if (e.key === "Home") {
        e.preventDefault();
        onwidthchange(180);
      } else if (e.key === "End") {
        e.preventDefault();
        onwidthchange(400);
      }
    }}
    style="position: absolute; top: 0; right: -4px; bottom: 0; width: 8px; cursor: col-resize; z-index: 10;"
  ></div>
</div>
