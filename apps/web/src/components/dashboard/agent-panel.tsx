import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useWs } from "../../hooks/use-ws";
import { StateBadge } from "../ui/state-badge";
import type { AgentSession } from "@emergent/contracts";

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function AgentPanel() {
  const { sendRpc, onPush } = useWs();
  const [agents, setAgents] = useState<AgentSession[]>([]);

  useEffect(() => {
    sendRpc("agents.list")
      .then((data) => setAgents(data as AgentSession[]))
      .catch(() => {});
  }, [sendRpc]);

  useEffect(() => {
    return onPush((channel, data) => {
      if (channel === "agents.changed") {
        setAgents(data as AgentSession[]);
      }
    });
  }, [onPush]);

  const displayed = agents.slice(0, 10);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">Agents</h2>
        <span className="text-xs text-neutral-500">
          {agents.length} total
        </span>
      </div>

      {displayed.length === 0 ? (
        <p className="text-sm text-neutral-500">No active agents</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-xs text-neutral-500">
                <th className="pb-2 pr-3 font-medium">Name</th>
                <th className="pb-2 pr-3 font-medium">State</th>
                <th className="pb-2 pr-3 font-medium">Capability</th>
                <th className="pb-2 pr-3 font-medium">Task</th>
                <th className="pb-2 font-medium text-right">Duration</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((agent) => (
                <tr
                  key={agent.name}
                  className="border-b border-neutral-800/50 last:border-0 hover:bg-neutral-800/30 transition-colors"
                >
                  <td className="py-2 pr-3">
                    <Link
                      to={"/agents/$agentName" as "/"}
                      params={{ agentName: agent.name } as Record<string, string>}
                      className="font-mono text-neutral-200 hover:text-cyan-400 transition-colors"
                    >
                      {agent.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">
                    <StateBadge state={agent.state} />
                  </td>
                  <td className="py-2 pr-3 text-neutral-300">
                    {agent.capability}
                  </td>
                  <td className="py-2 pr-3 max-w-[200px] truncate text-neutral-400 font-mono text-xs">
                    {agent.taskId ?? "—"}
                  </td>
                  <td className="py-2 text-right font-mono text-neutral-400">
                    {formatDuration(agent.duration)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {agents.length > 10 && (
        <div className="mt-3 text-right">
          <Link
            to={"/agents" as "/"}
            className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}
