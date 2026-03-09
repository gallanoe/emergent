import { useState, useEffect } from "react";
import { Reply, CheckCheck } from "lucide-react";
import { useWs } from "../../hooks/use-ws";
import { Badge, type BadgeVariant } from "../ui/badge";
import type { MailMessage, MailPriority } from "@emergent/contracts";

const priorityVariant: Record<MailPriority, BadgeVariant> = {
  urgent: "danger",
  high: "warning",
  normal: "default",
  low: "default",
};

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

interface MailDetailProps {
  messageId: string | null;
  onReply: (to: string, subject: string) => void;
}

export function MailDetail({ messageId, onReply }: MailDetailProps) {
  const { sendRpc } = useWs();
  const [message, setMessage] = useState<MailMessage | null>(null);

  useEffect(() => {
    if (!messageId) {
      setMessage(null);
      return;
    }

    // Fetch full message - we re-fetch mail list and find the one we need
    sendRpc("mail.list")
      .then((data) => {
        const messages = data as MailMessage[];
        const found = messages.find((m) => m.id === messageId) ?? null;
        setMessage(found);
      })
      .catch(() => {});
  }, [messageId, sendRpc]);

  function handleMarkRead() {
    if (!message) return;
    sendRpc("mail.read", { id: message.id })
      .then(() => setMessage((m) => (m ? { ...m, read: true } : null)))
      .catch(() => {});
  }

  if (!message) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">
        Select a message to view
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-neutral-800 p-4">
        <h2 className="text-base font-semibold text-neutral-100">
          {message.subject}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400">
          <span>
            From:{" "}
            <span className="font-mono text-neutral-200">{message.from}</span>
          </span>
          <span>
            To:{" "}
            <span className="font-mono text-neutral-200">{message.to}</span>
          </span>
          <span className="font-mono text-neutral-500">
            {formatTimestamp(message.timestamp)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Badge variant={priorityVariant[message.priority]}>
            {message.priority}
          </Badge>
          <Badge>{message.type}</Badge>
          {message.read && (
            <span className="text-xs text-neutral-500">read</span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-neutral-300">
          {message.body}
        </pre>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-neutral-800 px-4 py-3">
        {!message.read && (
          <button
            onClick={handleMarkRead}
            className="inline-flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 transition-colors"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark as read
          </button>
        )}
        <button
          onClick={() =>
            onReply(
              message.from,
              message.subject.startsWith("Re:")
                ? message.subject
                : `Re: ${message.subject}`,
            )
          }
          className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 transition-colors"
        >
          <Reply className="h-3.5 w-3.5" />
          Reply
        </button>
      </div>
    </div>
  );
}
