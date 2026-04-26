import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import DiffBody from "./DiffBody.svelte";

describe("DiffBody", () => {
  it("renders a removed row per line in oldText", () => {
    const { container } = render(DiffBody, {
      props: { oldText: "line1\nline2", newText: "" },
    });
    const removed = container.querySelectorAll("[data-diff-kind='removed']");
    expect(removed.length).toBe(2);
  });

  it("renders an added row per line in newText", () => {
    const { container } = render(DiffBody, {
      props: { oldText: "", newText: "a\nb\nc" },
    });
    const added = container.querySelectorAll("[data-diff-kind='added']");
    expect(added.length).toBe(3);
  });

  it("treats null oldText as a newly-created file (all added)", () => {
    const { container } = render(DiffBody, {
      props: { oldText: null, newText: "x\ny" },
    });
    const added = container.querySelectorAll("[data-diff-kind='added']");
    const removed = container.querySelectorAll("[data-diff-kind='removed']");
    expect(added.length).toBe(2);
    expect(removed.length).toBe(0);
  });

  it("renders a sign column with '-' for removed and '+' for added", () => {
    const { container } = render(DiffBody, {
      props: { oldText: "old", newText: "new" },
    });
    const signs = Array.from(container.querySelectorAll("[data-diff-sign]")).map((el) =>
      el.textContent?.trim(),
    );
    expect(signs).toContain("-");
    expect(signs).toContain("+");
  });

  it("renders line numbers starting at 1", () => {
    const { container } = render(DiffBody, {
      props: { oldText: "a\nb", newText: "c\nd" },
    });
    const nums = Array.from(container.querySelectorAll("[data-diff-lineno]")).map((el) =>
      el.textContent?.trim(),
    );
    expect(nums).toContain("1");
    expect(nums).toContain("2");
  });
});
