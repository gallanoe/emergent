import { createFileRoute } from "@tanstack/react-router";
import { CostSummary } from "../components/costs/cost-summary";
import { LiveTicker } from "../components/costs/live-ticker";

function CostsPage() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Costs & Tokens</h1>
      <CostSummary />
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="mb-3 text-sm font-medium text-neutral-400">
          Live Token Usage
        </h2>
        <LiveTicker />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/costs")({
  component: CostsPage,
});
