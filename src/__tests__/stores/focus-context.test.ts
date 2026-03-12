import { describe, it, expect, beforeEach } from "vitest";
import { useFocusContextStore } from "../../stores/focus-context";

describe("FocusContextStore", () => {
  beforeEach(() => {
    useFocusContextStore.setState({ activeRegion: "global" });
  });

  it("defaults to global region", () => {
    expect(useFocusContextStore.getState().activeRegion).toBe("global");
  });

  it("sets active region to sidebar", () => {
    useFocusContextStore.getState().setActiveRegion("sidebar");
    expect(useFocusContextStore.getState().activeRegion).toBe("sidebar");
  });

  it("sets active region to editor", () => {
    useFocusContextStore.getState().setActiveRegion("editor");
    expect(useFocusContextStore.getState().activeRegion).toBe("editor");
  });

  it("sets active region to workspace-picker", () => {
    useFocusContextStore.getState().setActiveRegion("workspace-picker");
    expect(useFocusContextStore.getState().activeRegion).toBe("workspace-picker");
  });
});
