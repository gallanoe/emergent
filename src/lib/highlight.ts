import { createHighlighter, type Highlighter } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// Supported grammars. Chosen to cover what chat users typically paste
// (TypeScript / JavaScript / Python / Rust / Bash / JSON / YAML / Markdown /
// HTML / CSS / Svelte). Adding a language means a ~150 KB grammar ships in
// the bundle, so keep this list lean.
const LANGS = [
  "typescript",
  "javascript",
  "python",
  "rust",
  "bash",
  "json",
  "yaml",
  "markdown",
  "html",
  "css",
  "svelte",
  "tsx",
  "jsx",
  "toml",
  "sql",
] as const;

type SupportedLang = (typeof LANGS)[number];
const LANG_SET: Set<string> = new Set(LANGS);

// Shiki v3 emits dual-theme HTML with CSS variables controlled by an outer
// selector. We use `github-dark` / `github-light` because they read well
// against our zinc surfaces and ship in the default theme bundle.
const THEMES = { light: "github-light", dark: "github-dark" } as const;

let highlighterPromise: Promise<Highlighter> | null = null;

function loadHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    // The JavaScript regex engine avoids loading the Oniguruma WASM binary,
    // which keeps the highlighter working in jsdom tests and removes a
    // runtime dependency on WASM streaming instantiation. It is marginally
    // slower on huge files than the Oniguruma engine but imperceptible for
    // chat-sized code blocks.
    highlighterPromise = createHighlighter({
      themes: Object.values(THEMES),
      langs: [...LANGS],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

const HIGHLIGHTED_ATTR = "data-shiki-highlighted";

function extractLang(codeEl: HTMLElement): SupportedLang | null {
  const cls = codeEl.className.match(/language-([a-z0-9+\-#]+)/i);
  if (!cls) return null;
  const raw = cls[1]!.toLowerCase();
  return LANG_SET.has(raw) ? (raw as SupportedLang) : null;
}

/**
 * Walk `root` for `<pre><code class="language-*">...</code></pre>` nodes and
 * replace each `<pre>`'s innerHTML with Shiki-highlighted output. Idempotent:
 * already-highlighted nodes (marked with `data-shiki-highlighted`) are
 * skipped. Unknown languages and empty code blocks are skipped silently.
 */
export async function highlightCodeBlocks(root: ParentNode): Promise<void> {
  const codeEls = Array.from(root.querySelectorAll<HTMLElement>("pre > code")).filter(
    (el) => !el.hasAttribute(HIGHLIGHTED_ATTR),
  );

  if (codeEls.length === 0) return;

  const eligible = codeEls
    .map((el) => ({ el, lang: extractLang(el) }))
    .filter((x): x is { el: HTMLElement; lang: SupportedLang } => x.lang !== null);

  if (eligible.length === 0) return;

  const highlighter = await loadHighlighter();

  for (const { el, lang } of eligible) {
    const source = el.textContent ?? "";
    if (!source) continue;
    // Per-block try/catch so a single malformed snippet during streaming
    // (unclosed string, truncated JSX, etc.) can't poison the whole pass.
    try {
      const html = highlighter.codeToHtml(source, {
        lang,
        themes: THEMES,
        defaultColor: false,
      });
      // Shiki wraps output in `<pre class="shiki ..."><code>…</code></pre>`.
      // Splice just the `<code>` inner — keep our `.md-pre-wrap` chrome intact.
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const shikiCode = parsed.querySelector("code");
      if (!shikiCode) continue;
      el.innerHTML = shikiCode.innerHTML;
      el.setAttribute(HIGHLIGHTED_ATTR, "true");
    } catch (err) {
      // Leave the plain text in place and mark as attempted so we don't
      // re-try on every render cycle.
      el.setAttribute(HIGHLIGHTED_ATTR, "error");
      console.warn(`Shiki failed to highlight ${lang} block:`, err);
    }
  }
}

/** Test-only: drop the cached highlighter between tests. */
export function __resetHighlighterForTests(): void {
  highlighterPromise = null;
}
