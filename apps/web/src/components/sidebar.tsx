import { useState, useEffect } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Activity,
  Mail,
  GitMerge,
  DollarSign,
  Play,
  Settings,
} from "lucide-react";
import { useWs } from "../hooks/use-ws";
import { useCoordinatorState } from "../hooks/use-overstory";
import { useWorkspaceStore } from "../stores/workspace-store";
import { Badge } from "./ui/badge";
import { isElectron } from "../env";
import type { StatusOverview } from "@emergent/contracts";

const navItems: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/agents", label: "Agents", icon: Users },
  { to: "/feed", label: "Feed", icon: Activity },
  { to: "/mail", label: "Mail", icon: Mail },
  { to: "/merges", label: "Merges", icon: GitMerge },
  { to: "/costs", label: "Costs", icon: DollarSign },
  { to: "/runs", label: "Runs", icon: Play },
  { to: "/settings", label: "Settings", icon: Settings },
];

function CoordinatorIndicator() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { data: coordState } = useCoordinatorState(activeWorkspaceId);

  if (!coordState || coordState.state === "disabled" || coordState.state === "idle") {
    return null;
  }

  let dotColor: string;
  let label: string;

  switch (coordState.state) {
    case "running":
      dotColor = "bg-green-500";
      label = "Coordinator running";
      break;
    case "checking":
    case "starting":
      dotColor = "bg-amber-500";
      label = "Starting coordinator...";
      break;
    case "stopping":
      dotColor = "bg-amber-500";
      label = "Stopping coordinator...";
      break;
    case "stopped":
      dotColor = "bg-neutral-500";
      label = "Coordinator stopped";
      break;
    case "error":
      dotColor = "bg-red-500";
      label = "Coordinator error";
      break;
    default:
      return null;
  }

  return (
    <div className="flex items-center gap-2 pb-1">
      <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
      <span>{label}</span>
    </div>
  );
}

function ConnectionStatus() {
  const { status } = useWs();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  let dotColor: string;
  let label: string;

  if (!activeWorkspaceId) {
    dotColor = "bg-neutral-600";
    label = "No workspace selected";
  } else if (status === "connected") {
    dotColor = "bg-green-500";
    label = "Connected";
  } else if (status === "connecting") {
    dotColor = "bg-amber-500";
    label = "Connecting...";
  } else {
    dotColor = "bg-red-500";
    label = "Disconnected";
  }

  return (
    <div className="flex items-center gap-2 text-xs text-neutral-500">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
      <span>{label}</span>
    </div>
  );
}

function QuickStatus() {
  const { sendRpc, onPush } = useWs();
  const [overview, setOverview] = useState<StatusOverview | null>(null);

  useEffect(() => {
    sendRpc("status.overview")
      .then((data) => setOverview(data as StatusOverview))
      .catch(() => {});
  }, [sendRpc]);

  useEffect(() => {
    return onPush((channel) => {
      if (channel === "agents.changed" || channel === "mail.new") {
        sendRpc("status.overview")
          .then((d) => setOverview(d as StatusOverview))
          .catch(() => {});
      }
    });
  }, [sendRpc, onPush]);

  if (!overview) return null;

  return (
    <div className="space-y-1.5 text-xs text-neutral-400">
      <CoordinatorIndicator />
      <div className="flex items-center justify-between">
        <span>Active agents</span>
        <span className="font-mono text-neutral-200">
          {overview.activeAgents}
        </span>
      </div>
      {overview.unreadMail > 0 && (
        <div className="flex items-center justify-between">
          <span>Unread mail</span>
          <Badge variant="info">{overview.unreadMail}</Badge>
        </div>
      )}
      {overview.errorCount > 0 && (
        <div className="flex items-center justify-between">
          <span>Errors</span>
          <Badge variant="danger">{overview.errorCount}</Badge>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <aside className="flex h-screen w-[240px] shrink-0 flex-col border-r border-neutral-800 bg-neutral-900">
      {/* Header — drag region for Electron titlebar */}
      <div
        className={`drag-region flex shrink-0 items-center border-b border-neutral-800 ${
          isElectron ? "h-[52px] px-4 pl-[82px]" : "h-[52px] px-4"
        }`}
      >
        <span className="text-sm font-bold text-neutral-200">Overstory</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        <ul className="space-y-0.5 px-2">
          {navItems.map(({ to, label, icon: Icon }) => {
            const isActive =
              to === "/"
                ? currentPath === "/"
                : currentPath.startsWith(to);

            return (
              <li key={to}>
                <Link
                  to={to as "/"}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-neutral-800 text-neutral-100"
                      : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Quick Status */}
      <div className="shrink-0 border-t border-neutral-800 p-3 space-y-2">
        <QuickStatus />
        <ConnectionStatus />
      </div>
    </aside>
  );
}
