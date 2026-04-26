import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import Mono from "./Mono.svelte";
import SLabel from "./SLabel.svelte";
import Kbd from "./Kbd.svelte";

describe("Mono", () => {
  it("renders children with mono font and default size", () => {
    const { container } = render(Mono, {
      props: {
        children: createRawSnippet(() => ({
          render: () => "<span>abc</span>",
        })),
      },
    });
    const outer = container.querySelector("span.font-mono") as HTMLElement | null;
    expect(outer?.textContent).toContain("abc");
    expect(outer).toBeTruthy();
    expect(outer?.style.fontSize).toBe("11px");
  });
});

describe("SLabel", () => {
  it("renders uppercase label styling", () => {
    render(SLabel, {
      props: {
        children: createRawSnippet(() => ({
          render: () => "<span>Section</span>",
        })),
      },
    });
    const el = screen.getByText("Section");
    expect(el.parentElement?.className).toContain("uppercase");
    expect(el.parentElement?.className).toContain("tracking-[0.08em]");
  });
});

describe("Kbd", () => {
  it("renders each key as a bordered chip", () => {
    render(Kbd, { props: { keys: ["⌘", "K"] } });
    expect(screen.getByText("⌘").className).toContain("border-border-default");
    expect(screen.getByText("K").className).toContain("bg-bg-elevated");
  });
});
