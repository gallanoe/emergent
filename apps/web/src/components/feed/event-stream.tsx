import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowDownToLine } from "lucide-react";
import { useWs } from "../../hooks/use-ws";
import { useUiStore } from "../../stores/ui-store";
import { Badge, type BadgeVariant } from "../ui/badge";
import type { StoredEvent, EventLevel } from "@emergent/contracts";

const typeVariantMap: Record<string, BadgeVariant> = {
  tool: "info",
  mail: "info",
  session_start: "success",
  session_end: "warning",
  error: "danger",
  spawn: "purple",
};

const levelColors: Record<EventLevel, string> = {
  info: "text-neutral-400",
  warn: "text-amber-400",
  error: "text-red-400",
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

export function EventStream() {
  const { sendRpc, onPush } = useWs();
  const { feedFollowMode, setFeedFollowMode } = useUiStore();
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [filterAgent, setFilterAgent] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterLevel, setFilterLevel] = useState<EventLevel | "">("");
  const [filterRun, setFilterRun] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sendRpc("events.query", { limit: 200 })
      .then((data) => setEvents(data as StoredEvent[]))
      .catch(() => {});
  }, [sendRpc]);

  useEffect(() => {
    return onPush((channel, data) => {
      if (channel === "events.new") {
        setEvents((prev) => [...prev, data as StoredEvent]);
      }
    });
  }, [onPush]);

  // Auto-scroll when in follow mode
  useEffect(() => {
    if (feedFollowMode && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events, feedFollowMode]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (!atBottom && feedFollowMode) {
      setFeedFollowMode(false);
    }
  }, [feedFollowMode, setFeedFollowMode]);

  const filtered = events.filter((event) => {
    if (filterAgent && event.agent !== filterAgent) return false;
    if (filterType && event.type !== filterType) return false;
    if (filterLevel && event.level !== filterLevel) return false;
    if (filterRun && event.runId !== filterRun) return false;
    return true;
  });

  // Collect unique values for filters
  const agentNames = [...new Set(events.map((e) => e.agent).filter(Boolean))];
  const eventTypes = [...new Set(events.map((e) => e.type))];

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2">
        <select
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 focus:border-cyan-600 focus:outline-none"
        >
          <option value="">All agents</option>
          {agentNames.map((name) => (
            <option key={name} value={name!}>
              {name}
            </option>
          ))}
        </select>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 focus:border-cyan-600 focus:outline-none"
        >
          <option value="">All types</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          value={filterLevel}
          onChange={(e) => setFilterLevel(e.target.value as EventLevel | "")}
          className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 focus:border-cyan-600 focus:outline-none"
        >
          <option value="">All levels</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>

        <input
          type="text"
          value={filterRun}
          onChange={(e) => setFilterRun(e.target.value)}
          placeholder="Run ID"
          className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-cyan-600 focus:outline-none w-32"
        />

        <div className="flex-1" />

        <button
          onClick={() => {
            setFeedFollowMode(!feedFollowMode);
            if (!feedFollowMode && containerRef.current) {
              containerRef.current.scrollTop =
                containerRef.current.scrollHeight;
            }
          }}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
            feedFollowMode
              ? "bg-cyan-900/50 text-cyan-400"
              : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
          }`}
          title="Follow mode"
        >
          <ArrowDownToLine className="h-3 w-3" />
          Follow
        </button>
      </div>

      {/* Event list */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4"
      >
        {filtered.length === 0 ? (
          <p className="text-sm text-neutral-500">No events</p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((event) => (
              <li
                key={event.id}
                className="flex items-start gap-2 rounded px-2 py-1 text-xs hover:bg-neutral-800/30 transition-colors"
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
                <span
                  className={`shrink-0 text-[10px] font-medium uppercase ${levelColors[event.level]}`}
                >
                  {event.level !== "info" ? event.level : ""}
                </span>
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
    </div>
  );
}
