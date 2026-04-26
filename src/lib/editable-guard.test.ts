import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isEditableTarget } from "./editable-guard";

describe("isEditableTarget", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.append(root);
  });

  afterEach(() => {
    root.remove();
  });

  it("returns true for input and textarea elements", () => {
    const input = document.createElement("input");
    root.append(input);
    const ta = document.createElement("textarea");
    root.append(ta);
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(ta)).toBe(true);
  });

  it("returns true when isContentEditable is true", () => {
    const div = document.createElement("div");
    Object.defineProperty(div, "isContentEditable", { value: true, configurable: true });
    root.append(div);
    expect(isEditableTarget(div)).toBe(true);
  });

  it("returns false for non-editable div and null", () => {
    const div = document.createElement("div");
    root.append(div);
    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
