import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useEditorStore } from "../../stores/editor";
import { TabBar } from "../../components/TabBar";

describe("TabBar — dirty tab close", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({
      openTabs: [{ path: "a.md", name: "a.md" }],
      activeTab: "a.md",
      dirtyTabs: new Set(["a.md"]),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("closes dirty tab without window.confirm", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<TabBar />);
    // The close button is the × span — find it
    const closeBtn = screen.getByText("×");
    fireEvent.click(closeBtn);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(useEditorStore.getState().openTabs).toHaveLength(0);
    confirmSpy.mockRestore();
  });
});
