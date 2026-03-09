import { useState, useEffect } from "react";
import { Clock, Users, DollarSign } from "lucide-react";
import { useWs } from "../../hooks/use-ws";
import { Badge, type BadgeVariant } from "../ui/badge";
import type { Run, AgentSession, MetricsSummary } from "@emergent/contracts";

const statusVariantMap: Record<string, BadgeVariant> = {
  active: "success",
  completed: "info",
  failed: "danger",
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

interface RunTimelineProps {
  runId: string;
}

export function RunTimeline({ runId }: RunTimelineProps) {
  const { sendRpc } = useWs();
  const [run, setRun] = useState<Run | null>(null);
  const [agents, setAgents] = useState<AgentSession[]>([]);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);

  useEffect(() => {
    sendRpc("runs.list")
      .then((data) => {
        const runs = data as Run[];
        setRun(runs.find((r) => r.id === runId) ?? null);
      })
      .catch(() => {});

    sendRpc("agents.list")
      .then((data) => {
        const allAgents = data as AgentSession[];
        setAgents(allAgents.filter((a) => a.runId === runId));
      })
      .catch(() => {});

    sendRpc("metrics.summary")
      .then((data) => setMetrics(data as MetricsSummary))
      .catch(() => {});
  }, [sendRpc, runId]);

  if (!run) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-neutral-500">
        Run not found
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Run header */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex items-center gap-3">
          <h2 className="font-mono text-lg font-semibold text-neutral-100">
            {run.id}
          </h2>
          <Badge variant={statusVariantMap[run.status] ?? "default"}>
            {run.status}
          </Badge>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-neutral-400">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {formatDuration(run.duration)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            {run.agentCount} agents
          </span>
          {metrics && (
            <span className="inline-flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" />
              {formatCost(metrics.totalCost)}
            </span>
          )}
        </div>
      </div>

      {/* Agent timeline */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="mb-4 text-sm font-semibold text-neutral-100">
          Agent Timeline
        </h3>

        {agents.length === 0 ? (
          <p className="text-sm text-neutral-500">No agents in this run</p>
        ) : (
          <div className="space-y-3">
            {agents.map((agent) => {
              const runStart = run.startedAt;
              const runEnd = run.endedAt ?? Date.now();
              const totalDuration = runEnd - runStart;
              const agentStart = agent.startedAt;
              const agentEnd = agentStart + agent.duration;
              const leftPct =
                totalDuration > 0
                  ? ((agentStart - runStart) / totalDuration) * 100
                  : 0;
              const widthPct =
                totalDuration > 0
                  ? (agent.duration / totalDuration) * 100
                  : 100;

              const stateColor: Record<string, string> = {
                booting: "bg-amber-500",
                working: "bg-green-500",
                stalled: "bg-red-500",
                zombie: "bg-neutral-500",
                completed: "bg-cyan-500",
              };

              return (
                <div key={agent.name} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate font-mono text-xs text-neutral-300">
                    {agent.name}
                  </span>
                  <div className="relative flex-1 h-5 rounded bg-neutral-800">
                    <div
                      className={`absolute top-0 h-full rounded ${stateColor[agent.state] ?? "bg-neutral-600"} opacity-70`}
                      style={{
                        left: `${Math.max(0, Math.min(leftPct, 100))}%`,
                        width: `${Math.max(1, Math.min(widthPct, 100 - leftPct))}%`,
                      }}
                      title={`${formatTime(agentStart)} - ${formatTime(agentEnd)}`}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right font-mono text-xs text-neutral-500">
                    {formatDuration(agent.duration)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cost summary for the run */}
      {metrics && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-neutral-100">
            Run Cost Summary
          </h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-neutral-500">Total Cost</p>
              <p className="mt-0.5 font-mono text-lg font-semibold text-neutral-100">
                {formatCost(metrics.totalCost)}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">Total Tokens</p>
              <p className="mt-0.5 font-mono text-lg font-semibold text-neutral-100">
                {metrics.totalTokens >= 1_000_000
                  ? `${(metrics.totalTokens / 1_000_000).toFixed(1)}M`
                  : metrics.totalTokens >= 1_000
                    ? `${(metrics.totalTokens / 1_000).toFixed(1)}k`
                    : String(metrics.totalTokens)}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">Agents</p>
              <p className="mt-0.5 font-mono text-lg font-semibold text-neutral-100">
                {run.agentCount}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">Duration</p>
              <p className="mt-0.5 font-mono text-lg font-semibold text-neutral-100">
                {formatDuration(run.duration)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
