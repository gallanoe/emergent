import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Circle } from "lucide-react";
import { useWs } from "../../hooks/use-ws";
import type { MailMessage } from "@emergent/contracts";

const priorityColor: Record<string, string> = {
  urgent: "text-red-400",
  high: "text-amber-400",
  normal: "text-neutral-400",
  low: "text-neutral-600",
};

export function MailMini() {
  const { sendRpc, onPush } = useWs();
  const [messages, setMessages] = useState<MailMessage[]>([]);

  useEffect(() => {
    sendRpc("mail.list", { unreadOnly: true })
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

  const unread = messages.filter((m) => !m.read);
  const displayed = unread.slice(0, 5);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">
          Unread Mail
          {unread.length > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full bg-cyan-900/50 px-1.5 py-0.5 text-xs text-cyan-400">
              {unread.length}
            </span>
          )}
        </h2>
        <Link
          to={"/mail" as "/"}
          className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {displayed.length === 0 ? (
        <p className="text-sm text-neutral-500">No unread messages</p>
      ) : (
        <ul className="space-y-2">
          {displayed.map((msg) => (
            <li
              key={msg.id}
              className="flex items-start gap-2 text-xs"
            >
              <Circle
                className={`mt-1 h-2 w-2 shrink-0 fill-current ${priorityColor[msg.priority] ?? "text-neutral-500"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-neutral-300">
                    {msg.from}
                  </span>
                  <span className="text-neutral-600">·</span>
                  <span className="truncate text-neutral-400">
                    {msg.subject}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
