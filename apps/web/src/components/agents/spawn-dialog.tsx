import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { useWs } from "../../hooks/use-ws";
import type { OvConfig } from "@emergent/contracts";

interface SpawnDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SpawnDialog({ open, onClose }: SpawnDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { sendRpc } = useWs();
  const [taskId, setTaskId] = useState("");
  const [capability, setCapability] = useState("");
  const [runtime, setRuntime] = useState("");
  const [config, setConfig] = useState<OvConfig | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    sendRpc("config.get")
      .then((data) => setConfig(data as OvConfig))
      .catch(() => {});
  }, [sendRpc]);

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
    setTaskId("");
    setCapability("");
    setRuntime("");
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!taskId.trim()) return;

    setSubmitting(true);
    try {
      await sendRpc("agents.sling", {
        taskId: taskId.trim(),
        capability: capability || undefined,
        runtime: runtime || undefined,
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
      className="w-full max-w-md rounded-lg border border-neutral-800 bg-neutral-900 p-0 text-neutral-100 shadow-2xl backdrop:bg-black/60"
    >
      <form onSubmit={handleSubmit}>
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-sm font-semibold">Spawn Agent</h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <label
              htmlFor="spawn-task-id"
              className="mb-1 block text-xs font-medium text-neutral-400"
            >
              Task ID <span className="text-red-400">*</span>
            </label>
            <input
              id="spawn-task-id"
              type="text"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              placeholder="e.g., implement-auth-flow"
              required
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-cyan-600 focus:outline-none focus:ring-1 focus:ring-cyan-600"
            />
          </div>

          <div>
            <label
              htmlFor="spawn-capability"
              className="mb-1 block text-xs font-medium text-neutral-400"
            >
              Capability
            </label>
            <select
              id="spawn-capability"
              value={capability}
              onChange={(e) => setCapability(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-cyan-600 focus:outline-none focus:ring-1 focus:ring-cyan-600"
            >
              <option value="">Default</option>
              {config?.capabilities.map((cap) => (
                <option key={cap} value={cap}>
                  {cap}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="spawn-runtime"
              className="mb-1 block text-xs font-medium text-neutral-400"
            >
              Runtime
            </label>
            <select
              id="spawn-runtime"
              value={runtime}
              onChange={(e) => setRuntime(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-cyan-600 focus:outline-none focus:ring-1 focus:ring-cyan-600"
            >
              <option value="">
                {config?.defaultRuntime
                  ? `Default (${config.defaultRuntime})`
                  : "Default"}
              </option>
              {config?.runtimes.map((rt) => (
                <option key={rt} value={rt}>
                  {rt}
                </option>
              ))}
            </select>
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
            disabled={submitting || !taskId.trim()}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Spawning..." : "Spawn"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
