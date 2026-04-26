import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ThemeSelect from "./ThemeSelect.svelte";

describe("ThemeSelect", () => {
  it("renders three segments", () => {
    const { getByRole } = render(ThemeSelect, {
      props: { value: "dark", onchange: vi.fn() },
    });
    expect(getByRole("button", { name: "system" })).toBeTruthy();
    expect(getByRole("button", { name: "dark" })).toBeTruthy();
    expect(getByRole("button", { name: "light" })).toBeTruthy();
  });

  it("clicking a segment calls onchange with that value", async () => {
    const onchange = vi.fn();
    const { getByRole } = render(ThemeSelect, {
      props: { value: "dark", onchange },
    });
    await fireEvent.click(getByRole("button", { name: "light" }));
    expect(onchange).toHaveBeenCalledWith("light");
  });

  it("active segment uses bg-bg-hover", () => {
    const { getByRole } = render(ThemeSelect, {
      props: { value: "system", onchange: vi.fn() },
    });
    expect(getByRole("button", { name: "system" }).className).toContain("bg-bg-hover");
  });
});
