import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import RuntimeGlyph from "./RuntimeGlyph.svelte";

describe("RuntimeGlyph", () => {
  it.each([
    ["running", "text-success"],
    ["stopped", "text-fg-muted"],
    ["building", "text-warning"],
    ["error", "text-error"],
  ] as const)("state %s applies %s color class", (state, needle) => {
    const { container } = render(RuntimeGlyph, { props: { state } });
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain(needle);
  });
});
