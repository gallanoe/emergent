import { describe, it, expect, beforeEach } from "vitest";
import { focusContextStore } from "./focus-context.svelte";

describe("FocusContextStore (Svelte)", () => {
  beforeEach(() => {
    focusContextStore.activeRegion = "global";
  });

  it("defaults to global region", () => {
    expect(focusContextStore.activeRegion).toBe("global");
  });

  it("sets active region to sidebar", () => {
    focusContextStore.setActiveRegion("sidebar");
    expect(focusContextStore.activeRegion).toBe("sidebar");
  });

  it("sets active region to editor", () => {
    focusContextStore.setActiveRegion("editor");
    expect(focusContextStore.activeRegion).toBe("editor");
  });

  it("sets active region to workspace-picker", () => {
    focusContextStore.setActiveRegion("workspace-picker");
    expect(focusContextStore.activeRegion).toBe("workspace-picker");
  });
});
