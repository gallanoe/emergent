import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import ConfigRow from "./ConfigRow.svelte";

describe("ConfigRow", () => {
  it("renders label and value", () => {
    const { getByText } = render(ConfigRow, {
      props: { label: "Name", value: "alpha" },
    });
    expect(getByText("Name")).toBeTruthy();
    expect(getByText("alpha")).toBeTruthy();
  });

  it("readOnly shows read-only tag instead of Edit", () => {
    const { getByText, queryByRole } = render(ConfigRow, {
      props: { label: "Path", value: "/tmp", readOnly: true },
    });
    expect(getByText("read-only")).toBeTruthy();
    expect(queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("non-readOnly shows Edit affordance", () => {
    const { getByRole } = render(ConfigRow, {
      props: { label: "Name", value: "x" },
    });
    expect(getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("last suppresses bottom border class", () => {
    const { container: bordered } = render(ConfigRow, {
      props: { label: "A", value: "1", last: false },
    });
    expect(bordered.firstElementChild?.className).toContain("border-b");

    const { container: plain } = render(ConfigRow, {
      props: { label: "B", value: "2", last: true },
    });
    expect(plain.firstElementChild?.className).not.toContain("border-b");
  });

  it("edit snippet replaces value and trailing cells", () => {
    const edit = createRawSnippet(() => ({
      render: () =>
        '<div style="display:contents"><span class="edit-val">custom value</span><span class="edit-trail">trail</span></div>',
    }));
    const { getByText, queryByText } = render(ConfigRow, {
      props: { label: "Theme", edit },
    });
    expect(getByText("Theme")).toBeTruthy();
    expect(getByText("custom value")).toBeTruthy();
    expect(getByText("trail")).toBeTruthy();
    expect(queryByText("read-only")).toBeNull();
    expect(queryByText("Edit")).toBeNull();
  });
});
