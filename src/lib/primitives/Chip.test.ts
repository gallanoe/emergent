import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import Chip from "./Chip.svelte";

const childSnippet = createRawSnippet(() => ({
  render: () => "<span>MID</span>",
}));

describe("Chip", () => {
  it("applies different surface classes for default vs active", () => {
    const { container: d } = render(Chip, {
      props: { active: false, children: childSnippet },
    });
    expect(d.firstElementChild?.className).toContain("bg-bg-elevated");

    const { container: a } = render(Chip, {
      props: { active: true, children: childSnippet },
    });
    expect(a.firstElementChild?.className).toContain("bg-bg-hover");
    expect(a.firstElementChild?.className).toContain("text-fg-heading");
  });

  it("uses transparent background for tone mono", () => {
    const { container } = render(Chip, {
      props: { tone: "mono", children: childSnippet },
    });
    expect(container.firstElementChild?.className).toContain("bg-transparent");
  });

  it("renders icon, children, then iconRight in order", () => {
    const { container } = render(Chip, {
      props: {
        icon: createRawSnippet(() => ({ render: () => "<span>A</span>" })),
        iconRight: createRawSnippet(() => ({ render: () => "<span>B</span>" })),
        children: childSnippet,
      },
    });
    expect(container.firstElementChild?.textContent?.replace(/\s/g, "")).toBe("AMIDB");
  });

  it("fires onclick when clicked", async () => {
    const onclick = vi.fn();
    const { container } = render(Chip, {
      props: { onclick, children: childSnippet },
    });
    await fireEvent.click(container.firstElementChild!);
    expect(onclick).toHaveBeenCalledOnce();
  });
});
