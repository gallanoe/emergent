import { listen } from "@tauri-apps/api/event";

// ── Types ──────────────────────────────────────────────────────────────────────

/** Wire payload emitted by Rust as "workspace:container-stats". Matches
 *  ContainerStatsPayload in emergent-protocol with #[serde(rename_all = "camelCase")]. */
export interface ContainerStatsPayload {
  workspaceId: string;
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  /** Raw bytes/sec measured over the last polling interval. */
  netBps: number;
}

/** Display-ready metrics for one workspace, with ring-buffer series for sparklines. */
export interface RuntimeMetrics {
  cpuPct: number;
  memMb: number;
  memLimitMb: number;
  /** Network throughput in KB/s (kibibytes/sec = netBps / 1024).
   *  OverviewView's fmtNet() formats this as "KB/s" / "MB/s". */
  netKbps: number;
  /** Last 12 CPU% samples (for sparkline). */
  cpuSeries: number[];
  /** Last 12 memory-MB samples (for sparkline). */
  memSeries: number[];
  /** Last 12 netKbps samples (for sparkline). */
  netSeries: number[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SERIES_LENGTH = 12;

function zeroSeries(): number[] {
  return Array<number>(SERIES_LENGTH).fill(0);
}

function zeroMetrics(): RuntimeMetrics {
  return {
    cpuPct: 0,
    memMb: 0,
    memLimitMb: 0,
    netKbps: 0,
    cpuSeries: zeroSeries(),
    memSeries: zeroSeries(),
    netSeries: zeroSeries(),
  };
}

// ── Ring-buffer helpers ────────────────────────────────────────────────────────

/** Push a new sample into a fixed-length ring buffer (oldest value is dropped). */
function pushSample(series: number[], value: number): number[] {
  const next = [...series, value];
  if (next.length > SERIES_LENGTH) next.shift();
  return next;
}

// ── Store ─────────────────────────────────────────────────────────────────────

function createContainerStats() {
  let statsMap = $state<Record<string, RuntimeMetrics>>({});

  // Listen for Tauri container-stats events. The listener is app-scoped (registered
  // once at module init) and is never torn down — mirrors usage.svelte.ts / agents.svelte.ts.
  listen<ContainerStatsPayload>("workspace:container-stats", (event) => {
    const p = event.payload;
    const existing = statsMap[p.workspaceId] ?? zeroMetrics();

    // Unit conversions:
    //   cpuPct      = cpuPercent         (already a percent, no conversion)
    //   memMb       = memoryBytes / 1024^2
    //   memLimitMb  = memoryLimitBytes / 1024^2
    //   netKbps     = netBps / 1024  (kibibytes/sec — matches OverviewView's "KB/s" label)
    const cpuPct = p.cpuPercent;
    const memMb = p.memoryBytes / (1024 * 1024);
    const memLimitMb = p.memoryLimitBytes / (1024 * 1024);
    const netKbps = p.netBps / 1024;

    statsMap[p.workspaceId] = {
      cpuPct,
      memMb,
      memLimitMb,
      netKbps,
      cpuSeries: pushSample(existing.cpuSeries, cpuPct),
      memSeries: pushSample(existing.memSeries, memMb),
      netSeries: pushSample(existing.netSeries, netKbps),
    };
  });

  return {
    /**
     * Returns the current RuntimeMetrics for a workspace.
     * If no stats have been received yet, returns a zero-filled default
     * (all numeric fields 0, all series arrays contain 12 zeros).
     * Never returns undefined.
     */
    runtimeFor(workspaceId: string): RuntimeMetrics {
      return statsMap[workspaceId] ?? zeroMetrics();
    },
  };
}

export const containerStats = createContainerStats();
