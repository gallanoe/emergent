import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import Button from "./Button.svelte";

const label = createRawSnippet(() => ({
  render: () => "<span>Label</span>",
}));

describe("Button", () => {
  it("primary variant uses accent surface classes", () => {
    const { container } = render(Button, {
      props: { variant: "primary", children: label },
    });
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("bg-accent");
    expect(btn?.className).toContain("text-accent-fg");
  });

  it("secondary variant uses elevated background", () => {
    const { container } = render(Button, {
      props: { variant: "secondary", children: label },
    });
    expect(container.querySelector("button")?.className).toContain("bg-bg-elevated");
  });

  it("ghost variant is transparent", () => {
    const { container } = render(Button, {
      props: { variant: "ghost", children: label },
    });
    expect(container.querySelector("button")?.className).toContain("bg-transparent");
  });

  it("danger variant uses error text", () => {
    const { container } = render(Button, {
      props: { variant: "danger", children: label },
    });
    expect(container.querySelector("button")?.className).toContain("text-error");
  });

  it("link variant is underlined without fixed control height", () => {
    const { container } = render(Button, {
      props: { variant: "link", children: label },
    });
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("underline");
    expect(btn?.className).not.toContain("h-[30px]");
  });

  it("applies xs height class", () => {
    const { container } = render(Button, {
      props: { size: "xs", children: label },
    });
    expect(container.querySelector("button")?.className).toContain("h-[22px]");
  });

  it("applies sm height class", () => {
    const { container } = render(Button, {
      props: { size: "sm", children: label },
    });
    expect(container.querySelector("button")?.className).toContain("h-[26px]");
  });

  it("applies md height class by default", () => {
    const { container } = render(Button, { props: { children: label } });
    expect(container.querySelector("button")?.className).toContain("h-[30px]");
  });

  it("applies lg height class", () => {
    const { container } = render(Button, {
      props: { size: "lg", children: label },
    });
    expect(container.querySelector("button")?.className).toContain("h-9");
  });

  it("does not fire onclick when disabled", async () => {
    const onclick = vi.fn();
    const { container } = render(Button, {
      props: { disabled: true, onclick, children: label },
    });
    await fireEvent.click(container.querySelector("button")!);
    expect(onclick).not.toHaveBeenCalled();
  });

  it("renders icon and iconRight snippets", () => {
    const { container } = render(Button, {
      props: {
        icon: createRawSnippet(() => ({ render: () => "<span>L</span>" })),
        iconRight: createRawSnippet(() => ({ render: () => "<span>R</span>" })),
        children: label,
      },
    });
    expect(container.textContent?.replace(/\s/g, "")).toContain("LLabelR");
  });

  it("renders Kbd when kbd prop is set", () => {
    const { container } = render(Button, {
      props: { kbd: ["⌘", "K"], children: label },
    });
    expect(container.textContent).toContain("⌘");
    expect(container.textContent).toContain("K");
  });
});
