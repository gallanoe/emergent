import { useState, useRef, useEffect } from "react";
import { ChevronDown, Plus, Circle } from "lucide-react";
import { useWs } from "../hooks/use-ws";
import { useWorkspaceStore } from "../stores/workspace-store";
import { isElectron } from "../env";
import type { Workspace } from "@emergent/contracts";

const statusColor: Record<string, string> = {
  connected: "text-green-400",
  disconnected: "text-neutral-500",
  error: "text-red-400",
};

export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const { sendRpc } = useWs();
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore();
  const ref = useRef<HTMLDivElement>(null);

  function refreshWorkspaces() {
    sendRpc("workspace.list")
      .then((data) => setWorkspaces(data as Workspace[]))
      .catch(() => {});
  }

  useEffect(() => {
    refreshWorkspaces();
  }, [sendRpc]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const active = workspaces.find((w) => w.id === activeWorkspaceId);

  function handleSelect(id: string) {
    setActiveWorkspaceId(id);
    sendRpc("workspace.setActive", { id }).catch(() => {});
    setOpen(false);
  }

  async function handleAddWorkspace() {
    let folderPath: string | null = null;

    if (isElectron) {
      folderPath = await (window as DesktopWindow).desktopBridge.pickFolder();
    } else {
      folderPath = prompt("Enter project path:");
    }

    if (!folderPath) return;

    try {
      const result = (await sendRpc("workspace.add", {
        path: folderPath,
      })) as Workspace;
      setActiveWorkspaceId(result.id);
      refreshWorkspaces();
    } catch {
      // workspace.add failed (e.g. no .overstory/ directory)
    }

    setOpen(false);
  }

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm text-neutral-200 hover:text-neutral-100 transition-colors"
      >
        <span className="truncate font-semibold">
          {active?.name ?? "Select workspace"}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute left-2 top-full z-50 mt-2 w-56 rounded-lg border border-neutral-700 bg-neutral-800 py-1 shadow-xl">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => handleSelect(ws.id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-neutral-700 ${
                ws.id === activeWorkspaceId
                  ? "text-neutral-100 bg-neutral-700/50"
                  : "text-neutral-300"
              }`}
            >
              <Circle
                className={`h-2 w-2 shrink-0 fill-current ${statusColor[ws.status] ?? "text-neutral-500"}`}
              />
              <span className="truncate">{ws.name}</span>
            </button>
          ))}

          {workspaces.length === 0 && (
            <p className="px-3 py-2 text-xs text-neutral-500">
              No workspaces yet
            </p>
          )}

          <div className="border-t border-neutral-700 mt-1 pt-1">
            <button
              onClick={handleAddWorkspace}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Workspace</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface DesktopBridge {
  getWsUrl: () => string | null;
  pickFolder: () => Promise<string | null>;
}

type DesktopWindow = typeof window & { desktopBridge: DesktopBridge };
