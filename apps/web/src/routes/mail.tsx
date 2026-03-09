import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import { MailList } from "../components/mail/mail-list";
import { MailDetail } from "../components/mail/mail-detail";
import { ComposeDialog } from "../components/mail/compose-dialog";

function MailPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<{
    to: string;
    subject: string;
  } | null>(null);

  const handleReply = (to: string, subject: string) => {
    setReplyTo({ to, subject });
    setComposeOpen(true);
  };

  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Mail</h1>
        <button
          onClick={() => {
            setReplyTo(null);
            setComposeOpen(true);
          }}
          className="flex items-center gap-2 rounded-md bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Compose
        </button>
      </div>
      <div className="grid flex-1 min-h-0 grid-cols-3 gap-4">
        <MailList onSelect={setSelectedId} selectedId={selectedId} />
        <div className="col-span-2">
          <MailDetail messageId={selectedId} onReply={handleReply} />
        </div>
      </div>
      <ComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        initialTo={replyTo?.to ?? ""}
        initialSubject={replyTo?.subject ?? ""}
      />
    </div>
  );
}

export const Route = createFileRoute("/mail")({
  component: MailPage,
});
