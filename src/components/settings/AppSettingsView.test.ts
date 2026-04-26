import { describe, it, expect, beforeEach, vi } from "vitest";
import { tick } from "svelte";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { flushSync } from "svelte";
import AppSettingsView from "./AppSettingsView.svelte";
import { themeStore } from "../../stores/theme.svelte";

const { getVersionMock } = vi.hoisted(() => ({
  getVersionMock: vi.fn(() => Promise.resolve("1.2.3")),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => getVersionMock(),
}));

describe("AppSettingsView", () => {
  beforeEach(() => {
    getVersionMock.mockClear();
    getVersionMock.mockResolvedValue("1.2.3");
    localStorage.setItem("emergent-theme", "dark");
    themeStore.setMode("dark");
    flushSync();
  });

  it("renders hero, appearance, placeholders, and cross-link copy", async () => {
    render(AppSettingsView);
    await tick();
    await tick();
    expect(screen.getByRole("heading", { name: "Application settings" })).toBeTruthy();
    expect(screen.getByText(/Emergent · 1\.2\.3/)).toBeTruthy();
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.getByText("Defaults for new workspaces")).toBeTruthy();
    expect(screen.getByText("Provider credentials")).toBeTruthy();
    expect(screen.getByText("Keyboard shortcuts")).toBeTruthy();
    expect(screen.getByText(/Workspace settings/i)).toBeTruthy();
  });

  it("ThemeSelect drives themeStore.setMode", async () => {
    const spy = vi.spyOn(themeStore, "setMode");
    render(AppSettingsView);
    await tick();
    await tick();
    await fireEvent.click(screen.getByRole("button", { name: "light" }));
    expect(spy).toHaveBeenCalledWith("light");
    spy.mockRestore();
  });
});
