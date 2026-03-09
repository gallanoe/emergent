import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import { AgentTable } from "../../components/agents/agent-table";
import { SpawnDialog } from "../../components/agents/spawn-dialog";

function AgentFleet() {
  const [spawnOpen, setSpawnOpen] = useState(false);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Agent Fleet</h1>
        <button
          onClick={() => setSpawnOpen(true)}
          className="flex items-center gap-2 rounded-md bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Spawn Agent
        </button>
      </div>
      <AgentTable />
      <SpawnDialog open={spawnOpen} onClose={() => setSpawnOpen(false)} />
    </div>
  );
}

export const Route = createFileRoute("/agents/")({
  component: AgentFleet,
});
