<script lang="ts">
  import { Mono } from "../../lib/primitives";
  import type { DisplayTask } from "../../stores/types";

  interface Props {
    task: DisplayTask;
    onOpen?: (taskId: string) => void;
  }

  let { task, onOpen }: Props = $props();
</script>

<div class="absolute top-0 left-0 right-0 z-[2] pointer-events-none">
  <div
    class="absolute top-0 left-0 right-0 h-[88px]"
    style="background: linear-gradient(to bottom, var(--color-background) 0%, var(--color-background) 40%, transparent 100%);"
  ></div>
  <button
    type="button"
    class="relative flex items-center gap-[10px] w-full px-5 py-[10px] pointer-events-auto text-left"
    onclick={() => onOpen?.(task.id)}
  >
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-fg-muted)"
      stroke-width="2"
    >
      <path d="m3 17 2 2 4-4"></path>
      <path d="m3 7 2 2 4-4"></path>
      <path d="M13 6h8"></path>
      <path d="M13 12h8"></path>
      <path d="M13 18h8"></path>
    </svg>
    <Mono size={10.5} color="var(--color-fg-muted)">task session</Mono>
    <Mono size={11}>{task.id}</Mono>
    <span class="text-[12px] truncate min-w-0">{task.title}</span>
  </button>
</div>
