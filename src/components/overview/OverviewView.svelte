<script lang="ts">
  import { ChevronDown } from "@lucide/svelte";
  import {
    AgentAvatar,
    StatusDot,
    RuntimeGlyph,
    Button,
    Mono,
    SLabel,
  } from "../../lib/primitives";
  import StatTile from "./StatTile.svelte";
  import MiniMetric from "./MiniMetric.svelte";
  import PipelineRow from "./PipelineRow.svelte";
  import { usageStore } from "../../stores/usage.svelte";
  import { mockMetrics } from "../../stores/mock-metrics.svelte";
  import type {
    DisplayWorkspace,
    DisplayTask,
    DisplayAgentDefinition,
  } from "../../stores/types";

  interface Props {
    workspace: DisplayWorkspace;
    tasks: DisplayTask[];
    onSelectThread: (id: string) => void;
    onOpenTasks: () => void;
  }

  let { workspace, tasks, onSelectThread, onOpenTasks }: Props = $props();

  // Load persisted usage for the current workspace whenever it changes.
  $effect(() => {
    usageStore.loadForWorkspace(workspace.id);
  });

  const allThreads = $derived(
    workspace.agentDefinitions.flatMap((d) => d.threads),
  );

  const liveThreads = $derived(
    allThreads.filter(
      (t) =>
        t.processStatus === "working" || t.processStatus === "initializing",
    ),
  );

  const activeAgents = $derived(
    workspace.agentDefinitions.filter((d) =>
      d.threads.some(
        (t) =>
          t.processStatus === "working" || t.processStatus === "initializing",
      ),
    ),
  );

  const tasksInFlight = $derived(
    tasks.filter((t) => t.status === "working" || t.status === "pending")
      .length,
  );

  const pipeline = $derived({
    working: tasks.filter((t) => t.status === "working").length,
    pending: tasks.filter((t) => t.status === "pending").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    failed: tasks.filter((t) => t.status === "failed").length,
  });

  const totalTokens = $derived(
    workspace.agentDefinitions.reduce((s, d) => {
      const u = usageStore.agentTotals(d.id);
      return s + u.totalTokens;
    }, 0),
  );

  const totalCost = $derived(
    workspace.agentDefinitions.reduce(
      (s, d) => s + usageStore.agentTotals(d.id).costAmount,
      0,
    ),
  );

  const maxUsage = $derived(
    Math.max(
      1,
      ...workspace.agentDefinitions.map(
        (d) => usageStore.agentTotals(d.id).totalTokens,
      ),
    ),
  );

  // TODO(real-metrics)
  const rt = $derived(mockMetrics.runtimeFor(workspace.id));

  const runtimeState = $derived(workspace.containerStatus.state);
  const runtimeStateLabel = $derived(
    runtimeState === "running"
      ? "Running"
      : runtimeState === "building"
        ? "Building"
        : runtimeState === "error"
          ? "Error"
          : "Stopped",
  );

  const runtimeGlyphState = $derived(
    runtimeState === "running"
      ? "running"
      : runtimeState === "building"
        ? "building"
        : runtimeState === "error"
          ? "error"
          : "stopped",
  );

  const runtimeSubtitle = $derived(
    runtimeState === "running"
      ? `container running · ${rt.memMb} MB`
      : `container ${runtimeState}`,
  );

  const heroMeta = $derived(
    runtimeState === "running"
      ? `container running · ${rt.memMb} MB · uptime —`
      : `container ${runtimeState}`,
  );

  function fmtK(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
  }

  function fmtNet(kbps: number): string {
    if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} MB/s`;
    return `${kbps} KB/s`;
  }

  function fmtMemCap(mb: number): string {
    if (mb >= 1024) return `${(mb / 1024).toFixed(0)} GB`;
    return `${mb} MB`;
  }

  function agentPct(def: DisplayAgentDefinition): {
    inputPct: number;
    outputPct: number;
  } {
    const u = usageStore.agentTotals(def.id);
    const total = u.totalTokens;
    const pct = (total / maxUsage) * 100;
    if (total === 0) return { inputPct: 0, outputPct: 0 };
    return {
      inputPct: (u.inputTokens / total) * pct,
      outputPct: (u.outputTokens / total) * pct,
    };
  }

  function defForThread(threadId: string): DisplayAgentDefinition | undefined {
    return workspace.agentDefinitions.find((d) =>
      d.threads.some((th) => th.id === threadId),
    );
  }
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto flex max-w-[1040px] flex-col gap-6 px-8 pb-10 pt-7">
      <!-- Hero -->
      <div class="flex items-start gap-4">
        <span
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-fg-heading text-[20px] font-bold leading-none tracking-[-0.02em] text-bg-base"
        >
          {workspace.name.charAt(0).toUpperCase()}
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-baseline gap-2.5">
            <h1
              class="m-0 text-[22px] font-semibold tracking-[-0.01em] text-fg-heading"
            >
              {workspace.name}
            </h1>
            <span class="text-[13px] text-fg-muted">overview</span>
          </div>
          <Mono size={11} color="var(--color-fg-disabled)" class="mt-1 block"
            >{heroMeta}</Mono
          >
        </div>
        <!-- TODO(real-metrics): wire time-range filter -->
        <Button variant="ghost" size="xs" type="button">
          {#snippet children()}Last 24h{/snippet}
          {#snippet iconRight()}
            <ChevronDown size={11} />
          {/snippet}
        </Button>
      </div>

      <!-- Stat tiles -->
      <div class="grid grid-cols-4 gap-3">
        <StatTile
          label="Active agents"
          value={activeAgents.length}
          sub={`of ${workspace.agentDefinitions.length} defined`}
        />
        <StatTile
          label="Live threads"
          value={liveThreads.length}
          sub={`${allThreads.length} total`}
        />
        <StatTile
          label="Tasks in flight"
          value={tasksInFlight}
          sub={`${pipeline.completed} done · ${pipeline.failed} failed`}
        />
        <StatTile
          label="Tokens · 24h"
          value={fmtK(totalTokens)}
          sub={`$${totalCost.toFixed(2)}`}
        />
      </div>

      <!-- Tokens + runtime -->
      <div class="grid grid-cols-[1.7fr_1fr] gap-3">
        <section
          class="overflow-hidden rounded-[10px] border border-border-default bg-bg-elevated"
        >
          <div
            class="flex items-baseline gap-2.5 border-b border-border-default px-3.5 py-3"
          >
            <SLabel>Tokens by agent · 24h</SLabel>
            <Mono size={10} color="var(--color-fg-disabled)"
              >input · output</Mono
            >
            <div class="min-w-0 flex-1"></div>
            <Mono size={10} color="var(--color-fg-disabled)"
              >{fmtK(totalTokens)}</Mono
            >
          </div>
          <div class="flex flex-col gap-2 px-3.5 py-2.5">
            {#each workspace.agentDefinitions as def (def.id)}
              {@const u = usageStore.agentTotals(def.id)}
              {@const p = agentPct(def)}
              <div
                class="grid grid-cols-[160px_1fr_72px_52px] items-center gap-2.5"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <AgentAvatar
                    provider={def.provider}
                    cli={def.cli}
                    name={def.name}
                    size={14}
                  />
                  <span class="truncate text-[12px] text-fg" title={def.name}
                    >{def.name}</span
                  >
                </div>
                <div
                  class="relative h-2.5 overflow-hidden rounded-full bg-bg-hover"
                >
                  <div
                    class="absolute bottom-0 left-0 top-0 bg-fg-muted/60"
                    style:width="{p.inputPct}%"
                  ></div>
                  <div
                    class="absolute bottom-0 top-0 bg-success"
                    style:left="{p.inputPct}%"
                    style:width="{p.outputPct}%"
                  ></div>
                </div>
                <Mono size={10.5} color="var(--color-fg-muted)"
                  >{fmtK(u.totalTokens)}</Mono
                >
                <Mono
                  size={10.5}
                  color="var(--color-fg-disabled)"
                  class="block text-right">${u.costAmount.toFixed(2)}</Mono
                >
              </div>
            {/each}
          </div>
        </section>

        <section
          class="overflow-hidden rounded-[10px] border border-border-default bg-bg-elevated"
        >
          <div class="border-b border-border-default px-3.5 py-3">
            <SLabel>Runtime</SLabel>
          </div>
          <div class="flex flex-col gap-3 px-3.5 py-3.5">
            <div class="flex items-center gap-2.5">
              <RuntimeGlyph state={runtimeGlyphState} size={24} />
              <div class="min-w-0 flex-1">
                <div class="text-[13px] font-medium text-fg-heading">
                  {runtimeStateLabel}
                </div>
                <Mono size={10.5} color="var(--color-fg-muted)"
                  >{runtimeSubtitle}</Mono
                >
              </div>
            </div>
            <MiniMetric
              label="CPU"
              value={`${rt.cpuPct}%`}
              series={rt.cpuSeries}
            />
            <MiniMetric
              label="Memory"
              value={`${rt.memMb} MB / ${fmtMemCap(rt.memLimitMb)}`}
              series={rt.memSeries}
            />
            <MiniMetric
              label="Network"
              value={fmtNet(rt.netKbps)}
              series={rt.netSeries}
            />
          </div>
        </section>
      </div>

      <!-- Live sessions + pipeline -->
      <div class="grid grid-cols-[1.4fr_1fr] gap-3">
        <section
          class="overflow-hidden rounded-[10px] border border-border-default bg-bg-base"
        >
          <div
            class="flex items-baseline gap-2.5 border-b border-border-default bg-bg-elevated px-3.5 py-2.5"
          >
            <SLabel>Live sessions</SLabel>
            <Mono size={10} color="var(--color-fg-disabled)"
              >{liveThreads.length}</Mono
            >
            <div class="min-w-0 flex-1"></div>
            <Mono size={10} color="var(--color-fg-disabled)">updated now</Mono>
          </div>
          {#if liveThreads.length === 0}
            <div
              class="px-4 py-[18px] text-center text-[12px] text-fg-disabled"
            >
              No sessions are working right now.
            </div>
          {:else}
            {#each liveThreads as t (t.id)}
              {@const def = defForThread(t.id)}
              <button
                type="button"
                class="grid w-full cursor-default grid-cols-[16px_140px_1fr_80px] items-center gap-2.5 border-b border-border-default px-3.5 py-2 text-left transition-colors duration-150 ease-out hover:bg-bg-hover last:border-b-0"
                onclick={() => onSelectThread(t.id)}
              >
                <StatusDot status={t.processStatus} size={6} />
                <div class="flex min-w-0 items-center gap-1.5">
                  <AgentAvatar
                    provider={def?.provider ?? null}
                    cli={def?.cli ?? null}
                    name={def?.name ?? "—"}
                    size={14}
                  />
                  <span
                    class="truncate text-[11.5px] text-fg-muted"
                    title={def?.name ?? "—"}>{def?.name ?? "—"}</span
                  >
                </div>
                <span
                  class="truncate text-[12.5px] text-fg-heading"
                  title={t.name}>{t.name}</span
                >
                <Mono
                  size={10}
                  color="var(--color-fg-disabled)"
                  class="block text-right"
                >
                  {t.taskId ?? t.updatedAt}
                </Mono>
              </button>
            {/each}
          {/if}
        </section>

        <section
          class="overflow-hidden rounded-[10px] border border-border-default bg-bg-base"
        >
          <div
            class="flex items-baseline gap-2.5 border-b border-border-default bg-bg-elevated px-3.5 py-2.5"
          >
            <SLabel>Task pipeline</SLabel>
            <Mono size={10} color="var(--color-fg-disabled)"
              >{tasks.length}</Mono
            >
            <div class="min-w-0 flex-1"></div>
            <button
              type="button"
              class="cursor-default text-[10.5px] text-fg-muted transition-colors duration-150 ease-out hover:text-fg-heading"
              onclick={() => onOpenTasks()}
            >
              Open Tasks →
            </button>
          </div>
          <div class="flex flex-col gap-3 px-3.5 py-3.5">
            <div
              class="flex h-2.5 min-h-[2px] overflow-hidden rounded-full bg-bg-hover"
            >
              <div
                class="min-w-0 bg-success"
                style:flex={pipeline.working}
              ></div>
              <div
                class="min-w-0 bg-fg-muted/55"
                style:flex={pipeline.pending}
              ></div>
              <div
                class="min-w-0 bg-fg-disabled/45"
                style:flex={pipeline.completed}
              ></div>
              <div class="min-w-0 bg-error" style:flex={pipeline.failed}></div>
            </div>
            <PipelineRow
              label="Working"
              count={pipeline.working}
              color="var(--color-success)"
            />
            <PipelineRow
              label="Pending"
              count={pipeline.pending}
              color="var(--color-fg-muted)"
              dim
            />
            <PipelineRow
              label="Completed"
              count={pipeline.completed}
              color="var(--color-fg-disabled)"
              dim
            />
            <PipelineRow
              label="Failed"
              count={pipeline.failed}
              color="var(--color-error)"
            />
          </div>
        </section>
      </div>
    </div>
  </div>
</div>
