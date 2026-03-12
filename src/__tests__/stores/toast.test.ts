import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useToastStore } from "../../components/Toast";

describe("useToastStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-removes toast after default 4s", () => {
    useToastStore.getState().addToast("hello", "info");
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("auto-removes toast after custom duration", () => {
    useToastStore.getState().addToast("hello", "info", undefined, 5000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("dismisses toast when action is triggered", () => {
    const onClick = vi.fn();
    useToastStore.getState().addToast("deleted", "info", { label: "Undo", onClick });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    const toast = useToastStore.getState().toasts[0]!;
    // Simulate what ToastContainer does when action is clicked
    useToastStore.getState().removeToast(toast.id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
