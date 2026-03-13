import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toastStore } from "../../stores/toast.svelte";

describe("ToastStore (Svelte)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toastStore.toasts = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-removes toast after default 4s", () => {
    toastStore.addToast("hello", "info");
    expect(toastStore.toasts).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(toastStore.toasts).toHaveLength(0);
  });

  it("auto-removes toast after custom duration", () => {
    toastStore.addToast("hello", "info", undefined, 5000);
    expect(toastStore.toasts).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(toastStore.toasts).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(toastStore.toasts).toHaveLength(0);
  });

  it("dismisses toast by id", () => {
    toastStore.addToast("deleted", "info", { label: "Undo", onClick: vi.fn() });
    expect(toastStore.toasts).toHaveLength(1);
    const toast = toastStore.toasts[0]!;
    toastStore.removeToast(toast.id);
    expect(toastStore.toasts).toHaveLength(0);
  });
});
