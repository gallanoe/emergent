import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import DaemonSplash from "./DaemonSplash.svelte";

describe("DaemonSplash", () => {
  it("shows app name and Starting text in starting state", () => {
    render(DaemonSplash, {
      props: { status: "starting" as const, error: null, retrying: false, onRetry: vi.fn() },
    });
    expect(screen.getByText("Emergent")).toBeTruthy();
    expect(screen.getByText("Starting…")).toBeTruthy();
  });

  it("shows error message and retry button in error state", () => {
    render(DaemonSplash, {
      props: {
        status: "launch_error" as const,
        error: "emergentd not found in PATH",
        retrying: false,
        onRetry: vi.fn(),
      },
    });
    expect(screen.getByText("Couldn't start daemon")).toBeTruthy();
    expect(screen.getByText("emergentd not found in PATH")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("calls onRetry when retry button is clicked", async () => {
    const onRetry = vi.fn();
    render(DaemonSplash, {
      props: {
        status: "launch_error" as const,
        error: "timeout",
        retrying: false,
        onRetry,
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows retrying state instead of error when retrying", () => {
    render(DaemonSplash, {
      props: {
        status: "launch_error" as const,
        error: "timeout",
        retrying: true,
        onRetry: vi.fn(),
      },
    });
    // When retrying, splash switches back to the spinner view
    expect(screen.getByText("Retrying…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });
});
