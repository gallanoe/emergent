import { describe, it, expect, beforeEach } from "vitest";
import { uiStore } from "../../stores/ui.svelte";

describe("UIStore (Svelte)", () => {
  beforeEach(() => {
    uiStore.sidebarCollapsed = false;
  });

  it("defaults to sidebar expanded", () => {
    expect(uiStore.sidebarCollapsed).toBe(false);
  });

  it("toggles sidebar", () => {
    uiStore.toggleSidebar();
    expect(uiStore.sidebarCollapsed).toBe(true);
    uiStore.toggleSidebar();
    expect(uiStore.sidebarCollapsed).toBe(false);
  });

  it("sets sidebar collapsed directly", () => {
    uiStore.setSidebarCollapsed(true);
    expect(uiStore.sidebarCollapsed).toBe(true);
  });
});
