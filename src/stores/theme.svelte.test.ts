import { describe, it, expect, beforeEach } from "vitest";
import { flushSync } from "svelte";
import { themeStore } from "./theme.svelte";

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.setItem("emergent-theme", "dark");
    themeStore.set("dark");
    flushSync();
  });

  it("applies data-theme to the document from the current value", () => {
    expect(themeStore.current).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("toggle flips the theme, attribute, and localStorage", () => {
    themeStore.toggle();
    flushSync();
    expect(themeStore.current).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("emergent-theme")).toBe("light");
    themeStore.toggle();
    flushSync();
    expect(themeStore.current).toBe("dark");
    expect(localStorage.getItem("emergent-theme")).toBe("dark");
  });

  it("set updates theme and syncs the attribute", () => {
    themeStore.set("light");
    flushSync();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("emergent-theme")).toBe("light");
  });
});
