// Token-usage fixtures for demo/test seeding.

export interface TokenUsage {
  input: number; // thousands
  output: number; // thousands
  cost: number; // USD
}

const EMPTY_USAGE: TokenUsage = { input: 0, output: 0, cost: 0 };

function createMockTokenMetrics() {
  const token = $state<Record<string, TokenUsage>>({});

  return {
    tokenFor(agentId: string): TokenUsage {
      return token[agentId] ?? EMPTY_USAGE;
    },
    seedAgent(agentId: string, u: TokenUsage) {
      token[agentId] = u;
    },
    clear() {
      for (const k of Object.keys(token)) delete token[k];
    },
  };
}

export const mockTokenMetrics = createMockTokenMetrics();
