import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import Input from "./Input.svelte";
import InputBindHarness from "./Input.bind.harness.svelte";

describe("Input", () => {
  it("reflects two-way binding via bind:value", async () => {
    render(InputBindHarness);
    const input = screen.getByRole("textbox");
    await fireEvent.input(input, { target: { value: "hello" } });
    expect(screen.getByTestId("bound").textContent).toBe("hello");
  });

  it("calls oninput while typing", async () => {
    const oninput = vi.fn();
    render(Input, {
      props: {
        value: "",
        oninput,
      },
    });
    const input = screen.getByRole("textbox");
    await fireEvent.input(input, { target: { value: "ab" } });
    expect(oninput).toHaveBeenCalledWith("ab");
  });

  it("applies error border classes when state is error", () => {
    const { container } = render(Input, {
      props: { value: "", state: "error" },
    });
    expect(container.firstElementChild?.className).toContain("border-error");
  });

  it("renders prefix and suffix snippets", () => {
    const { container } = render(Input, {
      props: {
        value: "",
        prefix: createRawSnippet(() => ({ render: () => "<span>P</span>" })),
        suffix: createRawSnippet(() => ({ render: () => "<span>S</span>" })),
      },
    });
    expect(container.textContent?.replace(/\s/g, "")).toContain("PS");
  });
});
