import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "../../stores/ui";

describe("UIStore", () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarCollapsed: false });
  });

  it("defaults to sidebar expanded", () => {
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it("toggles sidebar", () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it("sets sidebar collapsed directly", () => {
    useUIStore.getState().setSidebarCollapsed(true);
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });
});
