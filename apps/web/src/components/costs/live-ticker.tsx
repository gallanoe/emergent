import { useState, useEffect } from "react";
import { useWs } from "../../hooks/use-ws";
import type { LiveTokenUsage } from "@emergent/contracts";

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export function LiveTicker() {
  const { sendRpc, onPush } = useWs();
  const [usages, setUsages] = useState<LiveTokenUsage[]>([]);

  useEffect(() => {
    sendRpc("metrics.live")
      .then((data) => setUsages(data as LiveTokenUsage[]))
      .catch(() => {});
  }, [sendRpc]);

  useEffect(() => {
    return onPush((channel, data) => {
      if (channel === "metrics.snapshot") {
        // Refresh live data on metrics snapshot
        sendRpc("metrics.live")
          .then((d) => setUsages(d as LiveTokenUsage[]))
          .catch(() => {});
      }
    });
  }, [sendRpc, onPush]);

  if (usages.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="mb-3 text-sm font-semibold text-neutral-100">
          Live Token Usage
        </h3>
        <p className="text-sm text-neutral-500">No active sessions</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-3 text-sm font-semibold text-neutral-100">
        Live Token Usage
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-xs text-neutral-500">
              <th className="pb-2 pr-3 font-medium">Agent</th>
              <th className="pb-2 pr-3 font-medium">Model</th>
              <th className="pb-2 pr-3 font-medium text-right">Input</th>
              <th className="pb-2 pr-3 font-medium text-right">Output</th>
              <th className="pb-2 pr-3 font-medium text-right">Cache</th>
              <th className="pb-2 font-medium text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {usages.map((usage) => (
              <tr
                key={usage.agent}
                className="border-b border-neutral-800/50 last:border-0"
              >
                <td className="py-2 pr-3 font-mono text-neutral-200">
                  {usage.agent}
                </td>
                <td className="py-2 pr-3 text-neutral-400">{usage.model}</td>
                <td className="py-2 pr-3 text-right font-mono text-neutral-300">
                  {formatTokens(usage.inputTokens)}
                </td>
                <td className="py-2 pr-3 text-right font-mono text-neutral-300">
                  {formatTokens(usage.outputTokens)}
                </td>
                <td className="py-2 pr-3 text-right font-mono text-neutral-400">
                  {formatTokens(usage.cacheTokens)}
                </td>
                <td className="py-2 text-right font-mono text-neutral-200">
                  {formatCost(usage.estimatedCost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
