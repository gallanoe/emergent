import { useState, useEffect } from "react";
import { Play } from "lucide-react";
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

export function MergeTable() {
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

  function handleTrigger(id: string) {
    sendRpc("merge.trigger", { id }).catch(() => {});
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs text-neutral-500">
            <th className="pb-2 pr-3 font-medium">Status</th>
            <th className="pb-2 pr-3 font-medium">Agent</th>
            <th className="pb-2 pr-3 font-medium">Branch</th>
            <th className="pb-2 pr-3 font-medium text-right">Files</th>
            <th className="pb-2 pr-3 font-medium">Resolution</th>
            <th className="pb-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="py-8 text-center text-neutral-500"
              >
                Merge queue is empty
              </td>
            </tr>
          ) : (
            entries.map((entry) => (
              <tr
                key={entry.id}
                className="border-b border-neutral-800/50 last:border-0 hover:bg-neutral-800/30 transition-colors"
              >
                <td className="py-2.5 pr-3">
                  <Badge
                    variant={statusVariantMap[entry.status] ?? "default"}
                  >
                    {entry.status}
                  </Badge>
                </td>
                <td className="py-2.5 pr-3 font-mono text-neutral-200">
                  {entry.agent}
                </td>
                <td className="py-2.5 pr-3 max-w-[250px] truncate font-mono text-neutral-400">
                  {entry.branch}
                </td>
                <td className="py-2.5 pr-3 text-right font-mono text-neutral-300">
                  {entry.filesModified}
                </td>
                <td className="py-2.5 pr-3 text-neutral-400">
                  {entry.resolutionTier ?? "—"}
                </td>
                <td className="py-2.5 text-right">
                  {entry.status === "pending" && (
                    <button
                      onClick={() => handleTrigger(entry.id)}
                      className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-2 py-1 text-xs font-medium text-white hover:bg-cyan-500 transition-colors"
                      title="Trigger merge"
                    >
                      <Play className="h-3 w-3" />
                      Merge
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
