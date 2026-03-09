import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { RunTimeline } from "../../components/runs/run-timeline";

function RunDetail() {
  const { runId } = Route.useParams();

  return (
    <div className="p-6 space-y-6">
      <Link
        to="/runs"
        className="flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to runs
      </Link>
      <RunTimeline runId={runId} />
    </div>
  );
}

export const Route = createFileRoute("/runs/$runId")({
  component: RunDetail,
});
