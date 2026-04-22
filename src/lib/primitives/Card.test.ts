import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import Card from "./Card.svelte";

describe("Card", () => {
  it("renders children", () => {
    render(Card, {
      props: {
        children: createRawSnippet(() => ({
          render: () => "<span>Inside</span>",
        })),
      },
    });
    expect(screen.getByText("Inside")).toBeTruthy();
  });

  it("uses default padding of 14px", () => {
    const { container } = render(Card, {
      props: {
        children: createRawSnippet(() => ({
          render: () => "<span>x</span>",
        })),
      },
    });
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.padding).toBe("14px");
  });

  it("merges class onto the outer div", () => {
    const { container } = render(Card, {
      props: {
        class: "max-w-sm",
        children: createRawSnippet(() => ({
          render: () => "<span>y</span>",
        })),
      },
    });
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("max-w-sm");
    expect(el.className).toContain("rounded-lg");
  });
});
