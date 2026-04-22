// TODO(real-metrics): replace fixtures with wire data once the backend
// exposes token accounting and container metrics.

export interface TokenUsage {
  input: number; // thousands
  output: number; // thousands
  cost: number; // USD
}

export interface RuntimeMetrics {
  cpuPct: number;
  memMb: number;
  memLimitMb: number;
  netKbps: number;
  cpuSeries: number[]; // last 12 samples, rough 0..10 scale
  memSeries: number[];
  netSeries: number[];
}

const DEFAULT_RUNTIME: RuntimeMetrics = {
  cpuPct: 14,
  memMb: 312,
  memLimitMb: 2048,
  netKbps: 1200,
  cpuSeries: [2, 3, 2, 4, 6, 5, 4, 7, 5, 6, 8, 5],
  memSeries: [3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 6, 6],
  netSeries: [1, 0, 2, 4, 1, 3, 0, 2, 5, 3, 1, 2],
};

const EMPTY_USAGE: TokenUsage = { input: 0, output: 0, cost: 0 };

function createMockMetrics() {
  const token = $state<Record<string, TokenUsage>>({});
  const runtime = $state<Record<string, RuntimeMetrics>>({});

  return {
    tokenFor(agentId: string): TokenUsage {
      return token[agentId] ?? EMPTY_USAGE;
    },
    runtimeFor(workspaceId: string): RuntimeMetrics {
      return runtime[workspaceId] ?? DEFAULT_RUNTIME;
    },
    seedAgent(agentId: string, u: TokenUsage) {
      token[agentId] = u;
    },
    seedWorkspace(workspaceId: string, r: RuntimeMetrics) {
      runtime[workspaceId] = r;
    },
    clear() {
      for (const k of Object.keys(token)) delete token[k];
      for (const k of Object.keys(runtime)) delete runtime[k];
    },
  };
}

export const mockMetrics = createMockMetrics();
