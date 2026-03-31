import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ThemeToggle from "./ThemeToggle.svelte";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = "dark";
    localStorage.setItem("emergent-theme", "dark");
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
