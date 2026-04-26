<script lang="ts">
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { themeStore } from "../../stores/theme.svelte";
  import { Mono, SLabel } from "../../lib/primitives";
  import ConfigRow from "./ConfigRow.svelte";
  import ThemeSelect from "./ThemeSelect.svelte";

  let version = $state("");

  onMount(() => {
    void (async () => {
      try {
        version = await getVersion();
      } catch {
        version = "";
      }
    })();
  });
</script>

<div class="flex min-w-0 flex-1 flex-col">
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto flex max-w-[720px] flex-col gap-7 px-8 pb-10 pt-7">
      <!-- Hero -->
      <div class="flex items-start gap-4">
        <span
          class="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[10px] text-[20px] font-bold tracking-[-0.02em] text-bg-base"
          style="background: linear-gradient(135deg, var(--color-fg-heading), var(--color-fg-muted));"
        >
          E
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-baseline gap-[10px]">
            <h1
              class="text-[22px] font-semibold tracking-[-0.01em] text-fg-heading"
            >
              Application settings
            </h1>
            <span class="text-[13px] text-fg-muted">
              Emergent{version ? ` · ${version}` : ""}
            </span>
          </div>
          <Mono size={11} color="var(--color-fg-disabled)" class="mt-1">
            Global — applies to every workspace
          </Mono>
        </div>
      </div>

      <!-- Appearance -->
      <section class="flex flex-col gap-[10px]">
        <SLabel>Appearance</SLabel>
        <div class="rounded-[10px] border border-border-default bg-bg-elevated">
          <ConfigRow label="Theme">
            {#snippet edit()}
              <ThemeSelect
                value={themeStore.mode}
                onchange={(next) => themeStore.setMode(next)}
              />
              <span></span>
            {/snippet}
          </ConfigRow>
          <ConfigRow label="Density" value="Comfortable" readOnly />
          <ConfigRow label="Mono font" value="JetBrains Mono" readOnly last />
        </div>
      </section>

      <!-- Placeholder sections -->
      {#each [{ label: "Defaults for new workspaces", text: "Default container runtime, image base, and mount conventions applied when creating a new workspace." }, { label: "Provider credentials", text: "API keys for Claude, Codex, Gemini, OpenCode, Kiro. Shared across workspaces; redacted at rest." }, { label: "Keyboard shortcuts", text: "Rebindable shortcuts for New thread, Open workspace, Command palette, and pane navigation." }] as p (p.label)}
        <section class="flex flex-col gap-[10px]">
          <SLabel>{p.label}</SLabel>
          <div
            class="flex items-center gap-3 rounded-[10px] border border-dashed border-border-strong px-4 py-[14px]"
          >
            <Mono
              size={10}
              color="var(--color-fg-muted)"
              class="uppercase tracking-[0.06em]">To design</Mono
            >
            <span class="text-[12px] leading-[1.5] text-fg-muted">{p.text}</span
            >
          </div>
        </section>
      {/each}

      <!-- Cross-link (descriptive text, not a clickable link) -->
      <div class="text-[11.5px] leading-[1.5] text-fg-disabled">
        Looking for workspace-scoped settings (name, path, container runtime)?
        Open the workspace switcher and choose <em class="text-fg-muted"
          >Workspace settings</em
        >.
      </div>
    </div>
  </div>
</div>
