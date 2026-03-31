<script lang="ts">
  import { themeStore } from "../../stores/theme.svelte";
  import { Sun, Moon } from "@lucide/svelte";
</script>

<button
  class="interactive flex items-center justify-center w-[36px] h-[36px] rounded-[10px]
         border border-border-default bg-bg-elevated"
  title="Toggle theme"
  onclick={() => themeStore.toggle()}
>
  {#if themeStore.current === "dark"}
    <Sun size={16} class="text-fg-muted" />
  {:else}
    <Moon size={16} class="text-fg-muted" />
  {/if}
</button>
