import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useAgentInspection } from "../../hooks/use-overstory";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { StateBadge } from "../../components/ui/state-badge";
import type { AgentState } from "@emergent/contracts";

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function AgentInspect() {
  const { agentName } = Route.useParams();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { data: agent, isLoading } = useAgentInspection(
    agentName,
    activeWorkspaceId,
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-neutral-500">
        Loading...
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-6">
        <Link
          to="/agents"
          className="flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to agents
        </Link>
        <p className="mt-6 text-neutral-500">Agent not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Back link */}
      <Link
        to="/agents"
        className="flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to agents
      </Link>

      {/* Agent Header */}
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold font-mono tracking-tight">
          {agent.name}
        </h1>
        <StateBadge state={agent.state as AgentState} />
        {agent.capability && (
          <span className="text-sm text-neutral-400">{agent.capability}</span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <p className="text-xs text-neutral-500">Task</p>
          <p className="font-mono text-sm text-neutral-200">
            {agent.taskId ?? "—"}
          </p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <p className="text-xs text-neutral-500">Runtime</p>
          <p className="font-mono text-sm text-neutral-200">
            {agent.runtime ?? "—"}
          </p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <p className="text-xs text-neutral-500">Duration</p>
          <p className="font-mono text-sm text-neutral-200">
            {formatDuration(agent.duration)}
          </p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <p className="text-xs text-neutral-500">PID</p>
          <p className="font-mono text-sm text-neutral-200">
            {agent.pid ?? "—"}
          </p>
        </div>
      </div>

      {/* Token Usage */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-sm font-medium text-neutral-400">
            Token Usage
          </h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400">Input</span>
              <span className="font-mono text-neutral-200">
                {agent.tokenUsage.input.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400">Output</span>
              <span className="font-mono text-neutral-200">
                {agent.tokenUsage.output.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400">Cache</span>
              <span className="font-mono text-neutral-200">
                {agent.tokenUsage.cache.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-sm border-t border-neutral-800 pt-2">
              <span className="text-neutral-400">Est. Cost</span>
              <span className="font-mono text-neutral-200">
                ${agent.tokenUsage.estimatedCost.toFixed(4)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400">Model</span>
              <span className="font-mono text-neutral-200">
                {agent.tokenUsage.model}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-sm font-medium text-neutral-400">
            Tool Usage
          </h2>
          {agent.toolUsage.length === 0 ? (
            <p className="text-sm text-neutral-500">No tool calls recorded.</p>
          ) : (
            <div className="space-y-1.5">
              {agent.toolUsage.map((tool) => (
                <div
                  key={tool.name}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="font-mono text-neutral-300">
                    {tool.name}
                  </span>
                  <span className="text-neutral-400">
                    {tool.callCount}x &middot; avg {tool.avgDuration}ms
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Tool Calls */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="mb-3 text-sm font-medium text-neutral-400">
          Recent Tool Calls
        </h2>
        {agent.recentToolCalls.length === 0 ? (
          <p className="text-sm text-neutral-500">No recent tool calls.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-2">
            {agent.recentToolCalls.map((call, i) => (
              <div
                key={`${call.timestamp}-${i}`}
                className="rounded border border-neutral-800 bg-neutral-950 p-3 text-sm"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-cyan-400">{call.tool}</span>
                  <span className="text-neutral-500">
                    {call.duration}ms &middot;{" "}
                    {new Date(call.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <pre className="text-xs text-neutral-400 whitespace-pre-wrap break-all">
                  {call.args.slice(0, 200)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/agents/$agentName")({
  component: AgentInspect,
});
