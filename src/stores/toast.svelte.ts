type ToastType = "success" | "error" | "info";

export type Toast = {
  id: string;
  message: string;
  type: ToastType;
  action?: { label: string; onClick: () => void };
};

class ToastStore {
  toasts: Toast[] = $state([]);

  addToast(message: string, type: ToastType, action?: Toast["action"], duration?: number) {
    const id = crypto.randomUUID();
    const toast: Toast = { id, message, type };
    if (action) toast.action = action;
    this.toasts = [...this.toasts, toast];
    setTimeout(() => this.removeToast(id), duration ?? 4000);
  }

  removeToast(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}

export const toastStore = new ToastStore();
