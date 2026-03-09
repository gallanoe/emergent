import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { useWs } from "../../hooks/use-ws";
import type { MailType, MailPriority } from "@emergent/contracts";

interface ComposeDialogProps {
  open: boolean;
  onClose: () => void;
  initialTo?: string;
  initialSubject?: string;
}

export function ComposeDialog({
  open,
  onClose,
  initialTo = "",
  initialSubject = "",
}: ComposeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { sendRpc } = useWs();
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState("");
  const [type, setType] = useState<MailType>("task");
  const [priority, setPriority] = useState<MailPriority>("normal");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setTo(initialTo);
    setSubject(initialSubject);
  }, [initialTo, initialSubject]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [open]);

  function handleClose() {
    setTo("");
    setSubject("");
    setBody("");
    setType("task");
    setPriority("normal");
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!to.trim() || !subject.trim()) return;

    setSubmitting(true);
    try {
      await sendRpc("mail.send", {
        to: to.trim(),
        subject: subject.trim(),
        body: body.trim(),
        type,
        priority,
      });
      handleClose();
    } catch {
      // Error handling could be added here
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      className="w-full max-w-lg rounded-lg border border-neutral-800 bg-neutral-900 p-0 text-neutral-100 shadow-2xl backdrop:bg-black/60"
    >
      <form onSubmit={handleSubmit}>
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-sm font-semibold">Compose Mail</h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div>
            <label
              htmlFor="compose-to"
              className="mb-1 block text-xs font-medium text-neutral-400"
            >
              To <span className="text-red-400">*</span>
            </label>
            <input
              id="compose-to"
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Agent name"
              required
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-cyan-600 focus:outline-none focus:ring-1 focus:ring-cyan-600"
            />
          </div>

          <div>
            <label
              htmlFor="compose-subject"
              className="mb-1 block text-xs font-medium text-neutral-400"
            >
              Subject <span className="text-red-400">*</span>
            </label>
            <input
              id="compose-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              required
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-cyan-600 focus:outline-none focus:ring-1 focus:ring-cyan-600"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label
                htmlFor="compose-type"
                className="mb-1 block text-xs font-medium text-neutral-400"
              >
                Type
              </label>
              <select
                id="compose-type"
                value={type}
                onChange={(e) => setType(e.target.value as MailType)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-cyan-600 focus:outline-none focus:ring-1 focus:ring-cyan-600"
              >
                <option value="task">task</option>
                <option value="status">status</option>
                <option value="question">question</option>
                <option value="response">response</option>
              </select>
            </div>
            <div className="flex-1">
              <label
                htmlFor="compose-priority"
                className="mb-1 block text-xs font-medium text-neutral-400"
              >
                Priority
              </label>
              <select
                id="compose-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as MailPriority)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-cyan-600 focus:outline-none focus:ring-1 focus:ring-cyan-600"
              >
                <option value="low">low</option>
                <option value="normal">normal</option>
                <option value="high">high</option>
                <option value="urgent">urgent</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="compose-body"
              className="mb-1 block text-xs font-medium text-neutral-400"
            >
              Body
            </label>
            <textarea
              id="compose-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="Message body..."
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 font-mono text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-cyan-600 focus:outline-none focus:ring-1 focus:ring-cyan-600 resize-y"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-800 px-4 py-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !to.trim() || !subject.trim()}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
