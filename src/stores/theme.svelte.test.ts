import { describe, it, expect, beforeEach } from "vitest";
import { flushSync } from "svelte";
import { themeStore } from "./theme.svelte";

function changePreference(matches: boolean): MediaQueryListEvent {
  return Object.assign(new Event("change"), { matches }) as MediaQueryListEvent;
}

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.setItem("emergent-theme", "dark");
    window.matchMedia("(prefers-color-scheme: dark)").dispatchEvent(changePreference(true));
    themeStore.setMode("dark");
    flushSync();
  });

  it("applies data-theme to the document from the current value", () => {
    expect(themeStore.current).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("toggle flips the theme, attribute, and localStorage mode", () => {
    themeStore.toggle();
    flushSync();
    expect(themeStore.current).toBe("light");
    expect(themeStore.mode).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("emergent-theme")).toBe("light");
    themeStore.toggle();
    flushSync();
    expect(themeStore.current).toBe("dark");
    expect(localStorage.getItem("emergent-theme")).toBe("dark");
  });

  it("set updates explicit light/dark and syncs the attribute", () => {
    themeStore.set("light");
    flushSync();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("emergent-theme")).toBe("light");
  });

  it("setMode light flips the attribute after sync", () => {
    themeStore.setMode("light");
    flushSync();
    expect(themeStore.current).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("setMode system persists system and reacts to matchMedia change", () => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    themeStore.setMode("system");
    flushSync();
    expect(themeStore.mode).toBe("system");
    expect(localStorage.getItem("emergent-theme")).toBe("system");
    expect(themeStore.current).toBe("dark");

    mql.dispatchEvent(changePreference(false));
    flushSync();
    expect(themeStore.current).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
