import { useState, useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { StopCircle, MessageSquare, ArrowUpDown } from "lucide-react";
import { useWs } from "../../hooks/use-ws";
import { StateBadge } from "../ui/state-badge";
import type { AgentSession, AgentState } from "@emergent/contracts";

type SortField = "state" | "name" | "capability" | "taskId" | "duration";
type SortDir = "asc" | "desc";

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

const stateOrder: Record<AgentState, number> = {
  working: 0,
  booting: 1,
  stalled: 2,
  zombie: 3,
  completed: 4,
};

export function AgentTable() {
  const { sendRpc, onPush } = useWs();
  const [agents, setAgents] = useState<AgentSession[]>([]);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function handleStop(agentName: string) {
    sendRpc("agents.stop", { name: agentName }).catch(() => {});
  }

  function handleNudge(agentName: string) {
    sendRpc("agents.nudge", { name: agentName }).catch(() => {});
  }

  const sorted = useMemo(() => {
    const list = [...agents];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      switch (sortField) {
        case "state":
          return (stateOrder[a.state] - stateOrder[b.state]) * dir;
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "capability":
          return a.capability.localeCompare(b.capability) * dir;
        case "taskId":
          return (a.taskId ?? "").localeCompare(b.taskId ?? "") * dir;
        case "duration":
          return (a.duration - b.duration) * dir;
        default:
          return 0;
      }
    });
    return list;
  }, [agents, sortField, sortDir]);

  const columns: { key: SortField; label: string }[] = [
    { key: "state", label: "State" },
    { key: "name", label: "Name" },
    { key: "capability", label: "Capability" },
    { key: "taskId", label: "Task" },
    { key: "duration", label: "Duration" },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs text-neutral-500">
            {columns.map((col) => (
              <th key={col.key} className="pb-2 pr-3 font-medium">
                <button
                  onClick={() => handleSort(col.key)}
                  className="inline-flex items-center gap-1 hover:text-neutral-300 transition-colors"
                >
                  {col.label}
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
            ))}
            <th className="pb-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="py-8 text-center text-neutral-500"
              >
                No agents
              </td>
            </tr>
          ) : (
            sorted.map((agent) => (
              <tr
                key={agent.name}
                className="border-b border-neutral-800/50 last:border-0 hover:bg-neutral-800/30 transition-colors"
              >
                <td className="py-2.5 pr-3">
                  <StateBadge state={agent.state} />
                </td>
                <td className="py-2.5 pr-3">
                  <Link
                    to={"/agents/$agentName" as "/"}
                    params={{ agentName: agent.name } as Record<string, string>}
                    className="font-mono text-neutral-200 hover:text-cyan-400 transition-colors"
                  >
                    {agent.name}
                  </Link>
                </td>
                <td className="py-2.5 pr-3 text-neutral-300">
                  {agent.capability}
                </td>
                <td className="py-2.5 pr-3 max-w-[250px] truncate font-mono text-xs text-neutral-400">
                  {agent.taskId ?? "—"}
                </td>
                <td className="py-2.5 pr-3 font-mono text-neutral-400">
                  {formatDuration(agent.duration)}
                </td>
                <td className="py-2.5 text-right">
                  <div className="inline-flex items-center gap-1">
                    <button
                      onClick={() => handleNudge(agent.name)}
                      className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-amber-400 transition-colors"
                      title="Nudge agent"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleStop(agent.name)}
                      className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-red-400 transition-colors"
                      title="Stop agent"
                    >
                      <StopCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
