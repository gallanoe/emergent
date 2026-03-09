import { createFileRoute } from "@tanstack/react-router";
import { EventStream } from "../components/feed/event-stream";

function FeedPage() {
  return (
    <div className="flex h-full flex-col p-6">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Event Feed</h1>
      <div className="flex-1 min-h-0">
        <EventStream />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/feed")({
  component: FeedPage,
});
