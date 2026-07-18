import claudeLogo from "../assets/claude.svg";
import openaiLogo from "../assets/openai.svg";
import geminiLogo from "../assets/gemini.svg";
import kiroLogo from "../assets/kiro.svg";
import opencodeLogo from "../assets/opencode.svg";

const PROVIDER_LOGOS: Record<string, string> = {
  claude: claudeLogo,
  codex: openaiLogo,
  gemini: geminiLogo,
  kiro: kiroLogo,
  opencode: opencodeLogo,
} as const;

/** Friendly label for each provider id. Kept in sync with the
 * `KNOWN_AGENTS` table in `emergent-core` `detect.rs`. */
const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  kiro: "Kiro",
  opencode: "OpenCode",
} as const;

/**
 * Returns the logo asset URL for a persisted `AgentDefinition.provider` (or
 * `KnownAgent.provider`) — an explicit id chosen when the agent is created, not
 * derived from the spawn command.
 */
export function getLogoUrlForProvider(provider: string | null | undefined): string | null {
  if (provider == null || provider === "") return null;
  const k = provider.trim().toLowerCase();
  return PROVIDER_LOGOS[k] ?? null;
}

/** Friendly display name (e.g. "Claude Code") resolved from `provider`. */
export function getFriendlyNameForAgent(provider: string | null | undefined): string {
  const id = provider?.trim().toLowerCase();
  if (id && PROVIDER_LABELS[id]) return PROVIDER_LABELS[id];
  return "";
}
