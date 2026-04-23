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

  it("renders fenced code blocks with header, language, and copy control", () => {
    const html = renderMarkdown("```rust\nfn x() {}\n```");
    expect(html).toContain('<div class="md-pre-wrap">');
    expect(html).toContain('<span class="md-lang">rust</span>');
    expect(html).toContain('<button class="md-copy" type="button">Copy</button>');
    expect(html).toContain("fn x() {}");
    expect(html).toContain('<code class="language-rust">');
  });

  it("renders GFM note callout with callout-note class", () => {
    const html = renderMarkdown("> [!NOTE]\n> hi");
    expect(html).toContain('class="callout callout-note"');
    expect(html).toContain("callout-title");
    expect(html).toContain("hi");
  });

  it("emits a callout-icon span with the kind-specific glyph for note", () => {
    const html = renderMarkdown("> [!NOTE]\n> heads up");
    expect(html).toContain(`<span class="callout-icon">i</span>`);
  });

  it("uses a distinct glyph character per callout kind", () => {
    expect(renderMarkdown("> [!NOTE]\n> x")).toContain(`<span class="callout-icon">i</span>`);
    expect(renderMarkdown("> [!TIP]\n> x")).toContain(`<span class="callout-icon">✓</span>`);
    expect(renderMarkdown("> [!WARNING]\n> x")).toContain(`<span class="callout-icon">!</span>`);
    expect(renderMarkdown("> [!CAUTION]\n> x")).toContain(`<span class="callout-icon">!</span>`);
  });

  it("preserves the callout title text next to the icon", () => {
    const html = renderMarkdown("> [!WARNING]\n> careful");
    expect(html).toMatch(/<span class="callout-icon">!<\/span><span>Warning<\/span>/);
  });

  it("sanitization preserves md-copy button in code fences", () => {
    const html = renderMarkdown("```rust\nfn x() {}\n```");
    expect(html).toMatch(/<button class="md-copy"/);
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
