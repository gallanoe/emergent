import { Marked, type Tokens } from "marked";
import markedFootnote from "marked-footnote";
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

// Single-character glyphs for the filled-circle badge, per
// docs/design/v2/project/em-markdown.jsx:170-173. `important` is folded
// into `note` by cssKind mapping below, so it does not need a key here.
const CALLOUT_GLYPH: Record<string, string> = {
  note: "i",
  tip: "✓",
  warning: "!",
  caution: "!",
};

// Recursively strip synthetic `checkbox` tokens that marked's list tokenizer
// injects at the head of task-list items. Mutates nested paragraph/text
// token arrays in-place; top-level removal is handled by the caller.
function stripCheckboxTokens(tokens: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const t of tokens) {
    const tok = t as { type?: string; tokens?: unknown[] };
    if (tok.type === "checkbox") continue;
    if (tok.tokens && (tok.type === "paragraph" || tok.type === "text")) {
      tok.tokens = stripCheckboxTokens(tok.tokens);
    }
    out.push(tok);
  }
  return out;
}

const md = new Marked({ gfm: true, breaks: false, async: false });

md.use(markedFootnote());

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
      const glyph = CALLOUT_GLYPH[cssKind] ?? CALLOUT_GLYPH.note;
      // Layout per em-markdown.jsx:176-191: icon column on the left, then a
      // flex:1 column containing title (block) above body.
      return `<div class="callout callout-${cssKind}"><span class="callout-icon">${glyph}</span><div class="callout-body"><div class="callout-title">${escapeHtml(title)}</div>${innerHtml}</div></div>`;
    },
    // Wrap tables in a rounded bordered scroll-wrap so the radius survives
    // border-collapse (em-markdown.jsx:101-132, 265-270).
    table(token: Tokens.Table): string | false {
      const header = token.header
        .map((cell, i) => {
          const align = token.align?.[i];
          const attr = align ? ` align="${align}"` : "";
          const text = this.parser.parseInline(cell.tokens);
          return `<th${attr}>${text}</th>`;
        })
        .join("");
      const body = token.rows
        .map((row) => {
          const cells = row
            .map((cell, i) => {
              const align = token.align?.[i];
              const attr = align ? ` align="${align}"` : "";
              const text = this.parser.parseInline(cell.tokens);
              return `<td${attr}>${text}</td>`;
            })
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      return `<div class="md-table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
    },
    // Replace the default GFM task-list checkbox with a styled <span> so we
    // can render a proper SVG tick (em-markdown.jsx:195-207). Non-task-list
    // items fall through to marked's default renderer via `return false`.
    listitem(token: Tokens.ListItem): string | false {
      if (!token.task) return false;
      // Render the inner tokens ourselves so we can swap the default GFM
      // checkbox for a styled <span class="md-check">. Marked's list
      // tokenizer injects a synthetic `checkbox` token at the head of the
      // item (or nested inside the first paragraph); strip it here so we
      // don't emit the default <input type="checkbox">.
      const cleaned = stripCheckboxTokens(token.tokens as unknown[]) as Tokens.ListItem["tokens"];
      const inner = this.parser.parse(cleaned);
      const checkbox = `<span class="md-check" data-checked="${token.checked ? "true" : "false"}"></span>`;
      return `<li class="task-list-item">${checkbox}<span>${inner}</span></li>`;
    },
  },
});

const SANITIZE_CONFIG = {
  ADD_ATTR: ["class", "type", "align", "data-checked"],
};

/** Parse markdown string to sanitized HTML. */
export function renderMarkdown(content: string): string {
  if (!content) return "";
  const raw = md.parse(content) as string;
  return String(DOMPurify.sanitize(raw, SANITIZE_CONFIG));
}
