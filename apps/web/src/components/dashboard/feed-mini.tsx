import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useWs } from "../../hooks/use-ws";
import { Badge, type BadgeVariant } from "../ui/badge";
import type { StoredEvent } from "@emergent/contracts";

const typeVariantMap: Record<string, BadgeVariant> = {
  tool: "info",
  mail: "info",
  session_start: "success",
  session_end: "warning",
  error: "danger",
  spawn: "purple",
};

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function FeedMini() {
  const { sendRpc, onPush } = useWs();
  const [events, setEvents] = useState<StoredEvent[]>([]);

  useEffect(() => {
    sendRpc("events.query", { limit: 10 })
      .then((data) => setEvents(data as StoredEvent[]))
      .catch(() => {});
  }, [sendRpc]);

  useEffect(() => {
    return onPush((channel, data) => {
      if (channel === "events.new") {
        setEvents((prev) => [data as StoredEvent, ...prev].slice(0, 10));
      }
    });
  }, [onPush]);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">
          Recent Events
        </h2>
        <Link
          to={"/feed" as "/"}
          className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-neutral-500">No events yet</p>
      ) : (
        <ul className="space-y-1.5">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex items-start gap-2 text-xs leading-relaxed"
            >
              <span className="shrink-0 font-mono text-neutral-500">
                {formatTimestamp(event.timestamp)}
              </span>
              <Badge
                variant={typeVariantMap[event.type] ?? "default"}
                className="shrink-0"
              >
                {event.type}
              </Badge>
              {event.agent && (
                <span className="shrink-0 font-mono text-neutral-300">
                  {event.agent}
                </span>
              )}
              <span className="min-w-0 truncate text-neutral-400">
                {event.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
