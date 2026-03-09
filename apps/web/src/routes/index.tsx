import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => (
    <div className="flex flex-1 items-center justify-center">
      <h1 className="text-4xl font-bold tracking-tight text-neutral-900">
        Overstory
      </h1>
    </div>
  ),
});
