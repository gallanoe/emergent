import { createFileRoute } from "@tanstack/react-router";
import { MergeTable } from "../components/merges/merge-table";

function MergesPage() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Merge Queue</h1>
      <MergeTable />
    </div>
  );
}

export const Route = createFileRoute("/merges")({
  component: MergesPage,
});
