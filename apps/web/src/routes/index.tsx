import { createFileRoute } from "@tanstack/react-router";
import { AgentPanel } from "../components/dashboard/agent-panel";
import { FeedMini } from "../components/dashboard/feed-mini";
import { MailMini } from "../components/dashboard/mail-mini";
import { MergeQueueMini } from "../components/dashboard/merge-queue-mini";
import { MetricsMini } from "../components/dashboard/metrics-mini";
import {
  useStatusOverview,
  useCurrentRun,
  useCoordinatorState,
  useStartCoordinator,
  useStopCoordinator,
} from "../hooks/use-overstory";
import { useWorkspaceStore } from "../stores/workspace-store";

function CoordinatorBanner() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { data: coordState } = useCoordinatorState(activeWorkspaceId);
  const startCoordinator = useStartCoordinator();
  const stopCoordinator = useStopCoordinator();

  if (!coordState || !activeWorkspaceId) return null;

  switch (coordState.state) {
    case "starting":
    case "checking":
      return (
        <div className="flex items-center gap-3 rounded-lg border border-blue-800/50 bg-blue-950/30 px-4 py-3 text-sm text-blue-300">
          <svg
            className="h-4 w-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Starting overstory coordinator...
        </div>
      );

    case "error":
      return (
        <div className="flex items-center justify-between rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          <span>
            Coordinator error
            {coordState.error && coordState.error !== "ov_not_found"
              ? `: ${coordState.error}`
              : ""}
          </span>
          <button
            onClick={() =>
              startCoordinator.mutate({ workspaceId: activeWorkspaceId })
            }
            className="rounded bg-red-800/50 px-3 py-1 text-xs font-medium hover:bg-red-800/70 transition-colors"
          >
            Retry
          </button>
        </div>
      );

    case "disabled":
      // Check if it's because ov is not found
      if (coordState.error === "ov_not_found") {
        return (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 text-sm text-neutral-500">
            'ov' CLI not found — install Overstory to enable coordinator
          </div>
        );
      }
      return null;

    case "stopped":
      return (
        <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 text-sm text-neutral-400">
          <span>Coordinator stopped</span>
          <button
            onClick={() =>
              startCoordinator.mutate({ workspaceId: activeWorkspaceId })
            }
            className="rounded bg-neutral-800 px-3 py-1 text-xs font-medium hover:bg-neutral-700 transition-colors"
          >
            Start
          </button>
        </div>
      );

    case "running":
      return null; // No banner needed when running normally

    default:
      return null;
  }
}

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

      {/* Coordinator status banner */}
      <CoordinatorBanner />

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
