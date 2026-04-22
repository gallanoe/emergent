import { describe, it, expect, beforeEach } from "vitest";
import { flushSync } from "svelte";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ThemeToggle from "./ThemeToggle.svelte";
import { themeStore } from "../../stores/theme.svelte";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("emergent-theme", "dark");
    themeStore.set("dark");
    flushSync();
  });

  it("renders a button with accessible title", () => {
    render(ThemeToggle);
    expect(screen.getByTitle("Toggle theme")).toBeTruthy();
  });

  it("toggles data-theme on click", async () => {
    render(ThemeToggle);
    const btn = screen.getByTitle("Toggle theme");
    await fireEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe("light");
    await fireEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
