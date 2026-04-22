import claudeLogo from "../assets/claude.svg";
import openaiLogo from "../assets/openai.svg";
import geminiLogo from "../assets/gemini.svg";
import kiroLogo from "../assets/kiro.svg";
import opencodeLogo from "../assets/opencode.svg";

const CLI_LOGOS: Record<string, string> = {
  claude: claudeLogo,
  codex: openaiLogo,
  gemini: geminiLogo,
  kiro: kiroLogo,
  opencode: opencodeLogo,
} as const;

const LOGO_KEYS = Object.keys(CLI_LOGOS) as (keyof typeof CLI_LOGOS)[];

/** First path/command token, lowercased (handles `claude --acp` and `/opt/bin/gemini`). */
function firstCommandToken(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!t) return "";
  const first = t.split(/\s+/)[0] ?? t;
  if (first.includes("/")) {
    const base = first.split("/").pop() ?? first;
    return base;
  }
  return first;
}

export type CliLogoKey = keyof typeof CLI_LOGOS;

/**
 * Resolves a raw stored CLI string (command, path, or id like `claude-agent-acp`)
 * to a known logo key, or null.
 */
export function resolveCliLogoKey(raw: string): CliLogoKey | null {
  const first = firstCommandToken(raw);
  if (!first) return null;
  for (const key of LOGO_KEYS) {
    if (first === key) return key;
    if (first.startsWith(`${key}-`)) return key;
    if (first.startsWith(`${key}_`)) return key;
  }
  return null;
}

/** Returns the logo URL for a given CLI id, or null for unknown CLIs. */
export function getCliLogo(cli: string): string | null {
  const key = resolveCliLogoKey(cli);
  if (key == null) return null;
  const src = CLI_LOGOS[key];
  return src ?? null;
}
