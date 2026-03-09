import { useState, useEffect } from "react";
import { Circle } from "lucide-react";
import { useWs } from "../../hooks/use-ws";
import type { MailMessage, MailPriority } from "@emergent/contracts";

const priorityColor: Record<MailPriority, string> = {
  urgent: "text-red-400",
  high: "text-amber-400",
  normal: "text-neutral-400",
  low: "text-neutral-600",
};

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

interface MailListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function MailList({ selectedId, onSelect }: MailListProps) {
  const { sendRpc, onPush } = useWs();
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [filterAgent, setFilterAgent] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  useEffect(() => {
    sendRpc("mail.list")
      .then((data) => setMessages(data as MailMessage[]))
      .catch(() => {});
  }, [sendRpc]);

  useEffect(() => {
    return onPush((channel, data) => {
      if (channel === "mail.new") {
        setMessages((prev) => [data as MailMessage, ...prev]);
      }
    });
  }, [onPush]);

  const agentNames = [
    ...new Set(messages.flatMap((m) => [m.from, m.to])),
  ].sort();

  const filtered = messages.filter((msg) => {
    if (filterAgent && msg.from !== filterAgent && msg.to !== filterAgent)
      return false;
    if (filterType && msg.type !== filterType) return false;
    if (filterPriority && msg.priority !== filterPriority) return false;
    if (unreadOnly && msg.read) return false;
    return true;
  });

  return (
    <div className="flex h-full flex-col">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <select
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 focus:border-cyan-600 focus:outline-none"
        >
          <option value="">All agents</option>
          {agentNames.map((name) => (
            <option key={name} value={name}>
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
          <option value="task">task</option>
          <option value="status">status</option>
          <option value="question">question</option>
          <option value="response">response</option>
        </select>

        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 focus:border-cyan-600 focus:outline-none"
        >
          <option value="">All priorities</option>
          <option value="urgent">urgent</option>
          <option value="high">high</option>
          <option value="normal">normal</option>
          <option value="low">low</option>
        </select>

        <label className="inline-flex items-center gap-1 text-xs text-neutral-400 cursor-pointer">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
            className="rounded border-neutral-600 bg-neutral-800 text-cyan-500 focus:ring-cyan-600 focus:ring-offset-0"
          />
          Unread
        </label>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">No messages</p>
        ) : (
          <ul>
            {filtered.map((msg) => (
              <li key={msg.id}>
                <button
                  onClick={() => onSelect(msg.id)}
                  className={`flex w-full items-start gap-2 border-b border-neutral-800/50 px-3 py-2.5 text-left text-xs transition-colors hover:bg-neutral-800/30 ${
                    selectedId === msg.id
                      ? "bg-neutral-800/50"
                      : ""
                  }`}
                >
                  {/* Unread dot */}
                  <div className="mt-1.5 w-2 shrink-0">
                    {!msg.read && (
                      <Circle className="h-2 w-2 fill-cyan-400 text-cyan-400" />
                    )}
                  </div>

                  {/* Priority indicator */}
                  <Circle
                    className={`mt-1.5 h-2 w-2 shrink-0 fill-current ${priorityColor[msg.priority]}`}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-medium text-neutral-200 truncate">
                        {msg.from}
                      </span>
                      <span className="shrink-0 font-mono text-neutral-500">
                        {formatTimestamp(msg.timestamp)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-neutral-300">
                      {msg.subject}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
