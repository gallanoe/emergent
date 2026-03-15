import { describe, it, expect, beforeEach } from "vitest";
import { uiStore } from "./ui.svelte";

describe("UIStore", () => {
  beforeEach(() => {
    uiStore.setActiveView("workspace");
  });

  it("defaults to workspace view", () => {
    expect(uiStore.activeView).toBe("workspace");
  });

  it("switches active view", () => {
    uiStore.setActiveView("vcs");
    expect(uiStore.activeView).toBe("vcs");
    uiStore.setActiveView("workspace");
    expect(uiStore.activeView).toBe("workspace");
  });
});
