import { Marked } from "marked";
import DOMPurify from "dompurify";

// Create an isolated marked instance with GFM enabled
const md = new Marked({ gfm: true, breaks: false, async: false });

/** Parse markdown string to sanitized HTML. */
export function renderMarkdown(content: string): string {
  if (!content) return "";
  const raw = md.parse(content) as string;
  return DOMPurify.sanitize(raw);
}
