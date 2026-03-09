import { createFileRoute } from "@tanstack/react-router";
import { AgentPanel } from "../components/dashboard/agent-panel";
import { FeedMini } from "../components/dashboard/feed-mini";
import { MailMini } from "../components/dashboard/mail-mini";
import { MergeQueueMini } from "../components/dashboard/merge-queue-mini";
import { MetricsMini } from "../components/dashboard/metrics-mini";
import { useStatusOverview, useCurrentRun } from "../hooks/use-overstory";
import { useWorkspaceStore } from "../stores/workspace-store";

function Dashboard() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { data: overview } = useStatusOverview(activeWorkspaceId);
  const { data: currentRun } = useCurrentRun(activeWorkspaceId);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          {currentRun && (
            <p className="mt-1 text-sm text-neutral-400">
              Run{" "}
              <span className="font-mono text-neutral-300">
                {currentRun.id}
              </span>
              {" \u00b7 "}
              <span className="font-mono">{overview?.activeAgents ?? 0}</span>{" "}
              active agents
            </p>
          )}
        </div>
        {overview && (
          <div className="flex items-center gap-4 text-sm text-neutral-400">
            <span>
              Cost:{" "}
              <span className="font-mono text-neutral-200">
                ${overview.totalCost.toFixed(2)}
              </span>
            </span>
            <span>
              Burn:{" "}
              <span className="font-mono text-neutral-200">
                {overview.burnRate.toFixed(0)} tok/min
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Agent Panel + Tasks (spans 2+1 cols) */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <AgentPanel />
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-sm font-medium text-neutral-400">
            Quick Stats
          </h2>
          <MetricsMini />
        </div>
      </div>

      {/* Feed + Mail */}
      <div className="grid grid-cols-2 gap-4">
        <FeedMini />
        <MailMini />
      </div>

      {/* Merge Queue */}
      <div>
        <MergeQueueMini />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/")({
  component: Dashboard,
});
