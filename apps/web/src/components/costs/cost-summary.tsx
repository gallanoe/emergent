import { useState, useEffect } from "react";
import { useWs } from "../../hooks/use-ws";
import type { MetricsSummary, CostBreakdown } from "@emergent/contracts";

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

export function CostSummary() {
  const { sendRpc } = useWs();
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [breakdown, setBreakdown] = useState<CostBreakdown | null>(null);

  useEffect(() => {
    sendRpc("metrics.summary")
      .then((data) => setMetrics(data as MetricsSummary))
      .catch(() => {});
    sendRpc("costs.query")
      .then((data) => setBreakdown(data as CostBreakdown))
      .catch(() => {});
  }, [sendRpc]);

  const summaryCards = [
    {
      label: "Total Cost",
      value: breakdown ? formatCost(breakdown.total) : "—",
    },
    {
      label: "Total Tokens",
      value: breakdown ? formatTokens(breakdown.totalTokens) : "—",
    },
    {
      label: "Burn Rate",
      value: metrics ? `${formatTokens(metrics.burnRate)}/min` : "—",
    },
    {
      label: "Active Sessions",
      value: metrics ? String(metrics.activeSessions) : "—",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"
          >
            <p className="text-xs text-neutral-500">{card.label}</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-neutral-100">
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Per-agent cost table */}
      {breakdown && breakdown.byAgent.length > 0 && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-neutral-100">
            Cost by Agent
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-xs text-neutral-500">
                <th className="pb-2 pr-3 font-medium">Agent</th>
                <th className="pb-2 pr-3 font-medium text-right">Tokens</th>
                <th className="pb-2 font-medium text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.byAgent.map((entry) => (
                <tr
                  key={entry.label}
                  className="border-b border-neutral-800/50 last:border-0"
                >
                  <td className="py-2 pr-3 font-mono text-neutral-200">
                    {entry.label}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-neutral-400">
                    {formatTokens(entry.tokens)}
                  </td>
                  <td className="py-2 text-right font-mono text-neutral-300">
                    {formatCost(entry.cost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-capability cost table */}
      {breakdown && breakdown.byCapability.length > 0 && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-neutral-100">
            Cost by Capability
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-xs text-neutral-500">
                <th className="pb-2 pr-3 font-medium">Capability</th>
                <th className="pb-2 pr-3 font-medium text-right">Tokens</th>
                <th className="pb-2 font-medium text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.byCapability.map((entry) => (
                <tr
                  key={entry.label}
                  className="border-b border-neutral-800/50 last:border-0"
                >
                  <td className="py-2 pr-3 text-neutral-200">
                    {entry.label}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-neutral-400">
                    {formatTokens(entry.tokens)}
                  </td>
                  <td className="py-2 text-right font-mono text-neutral-300">
                    {formatCost(entry.cost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
