import { useState, useEffect } from "react";
import { useWs } from "../../hooks/use-ws";
import type { MetricsSummary } from "@emergent/contracts";

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

export function MetricsMini() {
  const { sendRpc, onPush } = useWs();
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);

  useEffect(() => {
    sendRpc("metrics.summary")
      .then((data) => setMetrics(data as MetricsSummary))
      .catch(() => {});
  }, [sendRpc]);

  useEffect(() => {
    return onPush((channel, data) => {
      if (channel === "metrics.snapshot") {
        setMetrics(data as MetricsSummary);
      }
    });
  }, [onPush]);

  const items = [
    {
      label: "Total Tokens",
      value: metrics ? formatTokens(metrics.totalTokens) : "—",
    },
    {
      label: "Total Cost",
      value: metrics ? formatCost(metrics.totalCost) : "—",
    },
    {
      label: "Burn Rate",
      value: metrics
        ? `${formatTokens(metrics.burnRate)}/min`
        : "—",
    },
    {
      label: "Sessions",
      value: metrics ? String(metrics.activeSessions) : "—",
    },
  ];

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="mb-3 text-sm font-semibold text-neutral-100">Metrics</h2>
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <div key={item.label}>
            <p className="text-xs text-neutral-500">{item.label}</p>
            <p className="font-mono text-lg font-semibold text-neutral-100">
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
