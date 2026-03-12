import { create } from "zustand";

type ToastType = "success" | "error" | "info";

type Toast = {
  id: string;
  message: string;
  type: ToastType;
  action?: { label: string; onClick: () => void } | undefined;
};

type ToastState = {
  toasts: Toast[];
  addToast: (message: string, type: ToastType, action?: Toast["action"]) => void;
  removeToast: (id: string) => void;
};

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  addToast: (message, type, action) => {
    const id = crypto.randomUUID();
    const toast: Toast = { id, message, type };
    if (action) toast.action = action;
    set({ toasts: [...get().toasts, toast] });
    setTimeout(() => get().removeToast(id), 4000);
  },
  removeToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

const TYPE_COLORS: Record<ToastType, string> = {
  success: "var(--color-success)",
  error: "var(--color-error)",
  info: "var(--color-accent)",
};

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 32,
        right: 16,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            background: "var(--color-bg-active)",
            border: "1px solid var(--color-border-default)",
            borderLeft: `3px solid ${TYPE_COLORS[toast.type]}`,
            borderRadius: 4,
            padding: "8px 12px",
            fontSize: 13,
            color: "var(--color-fg-default)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            maxWidth: 360,
            animation: "toast-in 150ms ease-out",
          }}
        >
          <span style={{ flex: 1 }}>{toast.message}</span>
          {toast.action && (
            <button
              onClick={toast.action.onClick}
              style={{
                background: "none",
                border: "none",
                color: "var(--color-accent-text)",
                fontSize: 12,
                cursor: "default",
                padding: "2px 6px",
              }}
            >
              {toast.action.label}
            </button>
          )}
          <span
            onClick={() => removeToast(toast.id)}
            style={{
              color: "var(--color-fg-muted)",
              fontSize: 10,
              cursor: "default",
            }}
          >
            ×
          </span>
        </div>
      ))}
    </div>
  );
}
