import { createFileRoute } from "@tanstack/react-router";
import { useConfig, useWorkspaces } from "../hooks/use-overstory";
import { useWorkspaceStore } from "../stores/workspace-store";
import { useWs } from "../hooks/use-ws";
import { Badge } from "../components/ui/badge";

function SettingsPage() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { data: config } = useConfig(activeWorkspaceId);
  const { data: workspaces } = useWorkspaces();
  const { status } = useWs();

  const activeWs = workspaces?.find((w) => w.id === activeWorkspaceId);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      {/* Connection Status */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="mb-3 text-sm font-medium text-neutral-400">
          Connection
        </h2>
        <div className="flex items-center gap-2 text-sm">
          <div
            className={`h-2 w-2 rounded-full ${
              status === "connected"
                ? "bg-green-500"
                : status === "connecting"
                  ? "bg-amber-500"
                  : "bg-red-500"
            }`}
          />
          <span className="text-neutral-200 capitalize">{status}</span>
        </div>
      </div>

      {/* Active Workspace */}
      {activeWs && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-sm font-medium text-neutral-400">
            Active Workspace
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-400">Name</span>
              <span className="text-neutral-200">{activeWs.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Path</span>
              <span className="font-mono text-neutral-200">
                {activeWs.path}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Status</span>
              <Badge
                variant={
                  activeWs.status === "connected" ? "success" : "danger"
                }
              >
                {activeWs.status}
              </Badge>
            </div>
          </div>
        </div>
      )}

      {/* Config */}
      {config && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-sm font-medium text-neutral-400">
            Overstory Config
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-400">Project</span>
              <span className="text-neutral-200">
                {config.projectName ?? "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Default Runtime</span>
              <span className="font-mono text-neutral-200">
                {config.defaultRuntime ?? "—"}
              </span>
            </div>
            {config.capabilities.length > 0 && (
              <div>
                <span className="text-neutral-400">Capabilities</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {config.capabilities.map((cap) => (
                    <Badge key={cap} variant="info">
                      {cap}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {config.runtimes.length > 0 && (
              <div>
                <span className="text-neutral-400">Runtimes</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {config.runtimes.map((rt) => (
                    <Badge key={rt} variant="purple">
                      {rt}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* All Workspaces */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="mb-3 text-sm font-medium text-neutral-400">
          All Workspaces
        </h2>
        {!workspaces || workspaces.length === 0 ? (
          <p className="text-sm text-neutral-500">No workspaces configured.</p>
        ) : (
          <div className="space-y-2">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
              >
                <div>
                  <span className="text-neutral-200">{ws.name}</span>
                  <span className="ml-2 font-mono text-xs text-neutral-500">
                    {ws.path}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className={`h-2 w-2 rounded-full ${
                      ws.status === "connected"
                        ? "bg-green-500"
                        : ws.status === "error"
                          ? "bg-red-500"
                          : "bg-neutral-500"
                    }`}
                  />
                  {ws.active && <Badge variant="success">active</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});
