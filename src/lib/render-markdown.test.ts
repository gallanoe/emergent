import { describe, it, expect } from "vitest";
import { renderMarkdown, segmentStream } from "./render-markdown";

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

  it("wraps callout title and body in a .callout-body column next to the icon", () => {
    const html = renderMarkdown("> [!WARNING]\n> careful");
    expect(html).toMatch(
      /<span class="callout-icon">!<\/span><div class="callout-body"><div class="callout-title">Warning<\/div>/,
    );
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

  describe("KaTeX math", () => {
    it("renders inline $…$ math", () => {
      const html = renderMarkdown("Energy $E = mc^2$ flows.");
      expect(html).toContain('class="katex"');
      expect(html).not.toContain('class="katex-display"');
    });

    it("renders block $$…$$ math in a display container", () => {
      const html = renderMarkdown("$$\\sum_{i=1}^n w_i$$");
      expect(html).toContain('class="katex-display"');
    });

    it("renders inline \\(…\\) math", () => {
      const html = renderMarkdown("value \\(a + b\\) here");
      expect(html).toContain('class="katex"');
      expect(html).not.toContain('class="katex-display"');
    });

    it("renders block \\[…\\] math in a display container", () => {
      const html = renderMarkdown("\\[a + b = c\\]");
      expect(html).toContain('class="katex-display"');
    });

    it("leaves currency-like prose untouched", () => {
      const html = renderMarkdown("It costs $5 and $10 total.");
      expect(html).not.toContain("katex");
      expect(html).toContain("$5 and $10");
    });

    it("does not treat $…$ inside a code fence as math", () => {
      const html = renderMarkdown("```\nprice = $5 + $x\n```");
      expect(html).not.toContain("katex");
      expect(html).toContain("$5 + $x");
    });

    it("preserves KaTeX inline styles through sanitization", () => {
      const html = renderMarkdown("$x^2$");
      // KaTeX positions glyphs with inline styles (e.g. height/vertical-align);
      // DOMPurify must keep them or the math collapses visually.
      expect(html).toMatch(/<span class="katex">/);
      expect(html).toMatch(/style="[^"]*em/);
    });
  });
});

describe("segmentStream", () => {
  it("returns nothing for empty content", () => {
    expect(segmentStream("", false)).toEqual({ committed: [], tail: "" });
  });

  it("holds a lone partial paragraph as the tail", () => {
    expect(segmentStream("Hello wor", false)).toEqual({ committed: [], tail: "Hello wor" });
  });

  it("splits a heading from adjacent body text with no blank line between", () => {
    const { committed, tail } = segmentStream("## Section\nBody being typ", false);
    expect(committed).toEqual(["## Section\n"]);
    expect(tail).toBe("Body being typ");
  });

  it("keeps the final block in the tail even after a trailing blank line", () => {
    // A trailing blank is not a commit signal: later text could still merge the
    // block backwards (loose lists, lazy continuation), so it stays in the tail
    // until another block follows or the turn is flushed.
    expect(segmentStream("Para one\n\n", false)).toEqual({ committed: [], tail: "Para one" });
  });

  it("commits earlier paragraphs only once a following block exists", () => {
    const { committed, tail } = segmentStream("Para one\n\nPara t", false);
    expect(committed).toEqual(["Para one"]);
    expect(tail).toBe("Para t");
  });

  it("never commits a list item that a later blank line could extend (loose list)", () => {
    // Regression: committing "- a" on the blank line would make it disappear
    // when "- a\n\n- b" re-lexes into one loose list. The whole list must stay
    // in the tail until a non-list block follows.
    expect(segmentStream("- a\n\n", false)).toEqual({ committed: [], tail: "- a" });
    expect(segmentStream("- a\n\n- b", false)).toEqual({ committed: [], tail: "- a\n\n- b" });
    const indented = segmentStream("- a\n\n    continuation", false);
    expect(indented.committed).toEqual([]);
    expect(indented.tail).toContain("- a");
  });

  it("commits a completed list atomically once a following paragraph starts", () => {
    const { committed, tail } = segmentStream("- a\n\n- b\n\nNext", false);
    expect(committed).toEqual(["- a\n\n- b"]);
    expect(tail).toBe("Next");
  });

  it("keeps an unclosed code fence atomic in the tail", () => {
    const { committed, tail } = segmentStream("Intro\n\n```rust\nfn main() {", false);
    expect(committed).toEqual(["Intro"]);
    expect(tail).toBe("```rust\nfn main() {");
  });

  it("commits a closed code fence once the next block starts", () => {
    const { committed, tail } = segmentStream("```rust\nfn x(){}\n```\n\nnex", false);
    expect(committed).toEqual(["```rust\nfn x(){}\n```"]);
    expect(tail).toBe("nex");
  });

  it("treats a growing list as a single atomic tail block", () => {
    expect(segmentStream("- a\n- b\n- c", false)).toEqual({ committed: [], tail: "- a\n- b\n- c" });
  });

  it("keeps a $$ math block atomic and committed", () => {
    const { committed, tail } = segmentStream("Before\n\n$$\nx^2\n$$\n\naf", false);
    expect(committed[0]).toBe("Before");
    expect(committed[1]).toContain("$$\nx^2\n$$");
    expect(tail).toBe("af");
  });

  it("commits the trailing block when flushed at end of turn", () => {
    const { committed, tail } = segmentStream("Para one\n\nlast line no newline", true);
    expect(committed).toEqual(["Para one", "last line no newline"]);
    expect(tail).toBe("");
  });

  it("does not throw on a footnote reference (bare lexer footnote guard)", () => {
    expect(() => segmentStream("Text with a ref[^1] here", false)).not.toThrow();
  });
});
