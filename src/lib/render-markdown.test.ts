import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./render-markdown";

describe("renderMarkdown", () => {
  it("renders plain text as a paragraph", () => {
    const html = renderMarkdown("Hello world");
    expect(html).toBe("<p>Hello world</p>\n");
  });

  it("renders inline code", () => {
    const html = renderMarkdown("Use `foo()` here");
    expect(html).toContain("<code>foo()</code>");
  });

  it("renders bold text", () => {
    const html = renderMarkdown("This is **bold**");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders fenced code blocks", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("const x = 1;");
  });

  it("renders GFM tables", () => {
    const html = renderMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("strips dangerous HTML (XSS)", () => {
    const html = renderMarkdown('<script>alert("xss")</script>');
    expect(html).not.toContain("<script>");
  });

  it("strips event handler attributes", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("returns empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });

  it("returns a string, not a Promise", () => {
    const result = renderMarkdown("test");
    expect(typeof result).toBe("string");
    expect(result).not.toBeInstanceOf(Promise);
  });
});
