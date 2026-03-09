import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useWs } from "../../hooks/use-ws";
import { Badge, type BadgeVariant } from "../ui/badge";
import type { MergeEntry } from "@emergent/contracts";

const statusVariantMap: Record<string, BadgeVariant> = {
  merged: "success",
  pending: "warning",
  merging: "info",
  conflict: "danger",
  failed: "danger",
};

export function MergeQueueMini() {
  const { sendRpc, onPush } = useWs();
  const [entries, setEntries] = useState<MergeEntry[]>([]);

  useEffect(() => {
    sendRpc("merge.queue")
      .then((data) => setEntries(data as MergeEntry[]))
      .catch(() => {});
  }, [sendRpc]);

  useEffect(() => {
    return onPush((channel, data) => {
      if (channel === "merge.changed") {
        sendRpc("merge.queue")
          .then((d) => setEntries(d as MergeEntry[]))
          .catch(() => {});
      }
    });
  }, [sendRpc, onPush]);

  const pending = entries.filter(
    (e) => e.status === "pending" || e.status === "merging",
  );

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">
          Merge Queue
          {pending.length > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-900/50 px-1.5 py-0.5 text-xs text-amber-400">
              {pending.length}
            </span>
          )}
        </h2>
        <Link
          to={"/merges" as "/"}
          className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-neutral-500">Queue empty</p>
      ) : (
        <ul className="space-y-2">
          {entries.slice(0, 5).map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-2 text-xs"
            >
              <Badge
                variant={statusVariantMap[entry.status] ?? "default"}
                className="shrink-0"
              >
                {entry.status}
              </Badge>
              <span className="font-mono text-neutral-300 shrink-0">
                {entry.agent}
              </span>
              <span className="min-w-0 truncate font-mono text-neutral-500">
                {entry.branch}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
