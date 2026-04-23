import { describe, it, expect, beforeAll } from "vitest";
import { highlightCodeBlocks, __resetHighlighterForTests } from "./highlight";

function container(html: string): HTMLDivElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("highlightCodeBlocks", () => {
  beforeAll(() => {
    __resetHighlighterForTests();
  });

  it("replaces a typescript code block's innerHTML with Shiki output", async () => {
    const root = container(
      `<pre><code class="language-typescript">const x: number = 1;</code></pre>`,
    );
    await highlightCodeBlocks(root);
    const codeEl = root.querySelector("code")!;
    // Shiki emits per-token <span style="..."> wrappers with CSS vars for
    // both themes. We assert structural change (token spans present) and
    // that the source text is still readable, without coupling to
    // implementation details like the literal "shiki" string.
    expect(codeEl.querySelectorAll("span").length).toBeGreaterThan(0);
    expect(codeEl.textContent).toContain("const");
    expect(codeEl.getAttribute("data-shiki-highlighted")).toBe("true");
  });

  it("leaves code blocks without a language class untouched", async () => {
    const root = container(`<pre><code>plain text</code></pre>`);
    const before = root.innerHTML;
    await highlightCodeBlocks(root);
    expect(root.innerHTML).toBe(before);
  });

  it("is idempotent — a second call leaves the DOM unchanged", async () => {
    const root = container(`<pre><code class="language-javascript">let y = 2;</code></pre>`);
    await highlightCodeBlocks(root);
    const afterFirst = root.innerHTML;
    await highlightCodeBlocks(root);
    expect(root.innerHTML).toBe(afterFirst);
  });

  it("skips unknown languages without throwing", async () => {
    const root = container(`<pre><code class="language-brainfuck">+++</code></pre>`);
    await expect(highlightCodeBlocks(root)).resolves.toBeUndefined();
    const codeEl = root.querySelector("code")!;
    expect(codeEl.textContent).toBe("+++");
  });
});
