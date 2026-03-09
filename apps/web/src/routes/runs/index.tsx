import { createFileRoute, Link } from "@tanstack/react-router";
import { useRuns } from "../../hooks/use-overstory";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { Badge } from "../../components/ui/badge";
import type { BadgeVariant } from "../../components/ui/badge";

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const statusVariant: Record<string, BadgeVariant> = {
  active: "success",
  completed: "info",
  failed: "danger",
};

function RunList() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { data: runs } = useRuns(activeWorkspaceId);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Runs</h1>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-neutral-400">
              <th className="px-4 py-3 font-medium">Run ID</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Agents</th>
              <th className="px-4 py-3 font-medium">Duration</th>
              <th className="px-4 py-3 font-medium">Started</th>
            </tr>
          </thead>
          <tbody>
            {!runs || runs.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-neutral-500"
                >
                  No runs recorded.
                </td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-neutral-800/50 hover:bg-neutral-800/30"
                >
                  <td className="px-4 py-3">
                    <Link
                      to="/runs/$runId"
                      params={{ runId: run.id }}
                      className="font-mono text-cyan-400 hover:underline"
                    >
                      {run.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant[run.status] ?? "default"}>
                      {run.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-neutral-300">
                    {run.agentCount}
                  </td>
                  <td className="px-4 py-3 font-mono text-neutral-300">
                    {formatDuration(run.duration)}
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    {new Date(run.startedAt).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/runs/")({
  component: RunList,
});
