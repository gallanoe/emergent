import { Marked, type Tokens } from "marked";
import DOMPurify from "dompurify";

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const ALERT_RE = /^\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\]\s*\n?([\s\S]*)$/i;

const ALERT_TITLE: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  warning: "Warning",
  caution: "Caution",
  important: "Important",
};

const md = new Marked({ gfm: true, breaks: false, async: false });

md.use({
  renderer: {
    code(token: Tokens.Code): string | false {
      const lang = (token.lang ?? "").trim();
      const langSpan = lang ? `<span class="md-lang">${escapeHtml(lang.toLowerCase())}</span>` : "";
      const codeClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      return `<div class="md-pre-wrap"><div class="md-pre-header">${langSpan}<button class="md-copy" type="button">Copy</button></div><pre><code${codeClass}>${escapeHtml(token.text)}</code></pre></div>`;
    },
    blockquote(token: Tokens.Blockquote): string | false {
      const rawText =
        token.tokens?.[0]?.type === "paragraph"
          ? ((token.tokens[0] as Tokens.Paragraph).text ?? "")
          : (token.text ?? "");
      const match = ALERT_RE.exec(rawText.trim());
      if (!match) return false;
      const rawKind = match[1]!.toLowerCase();
      const cssKind = rawKind === "important" ? "note" : rawKind;
      const title = ALERT_TITLE[rawKind] ?? rawKind;
      const body = match[2]!.trim();
      const innerHtml = md.parse(body) as string;
      return `<div class="callout callout-${cssKind}"><div class="callout-title">${escapeHtml(title)}</div>${innerHtml}</div>`;
    },
  },
});

const SANITIZE_CONFIG = {
  ADD_ATTR: ["class", "type"],
};

/** Parse markdown string to sanitized HTML. */
export function renderMarkdown(content: string): string {
  if (!content) return "";
  const raw = md.parse(content) as string;
  return String(DOMPurify.sanitize(raw, SANITIZE_CONFIG));
}
