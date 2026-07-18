import claudeLogo from "../assets/claude.svg";
import openaiLogo from "../assets/openai.svg";
import geminiLogo from "../assets/gemini.svg";
import kiroLogo from "../assets/kiro.svg";
import opencodeLogo from "../assets/opencode.svg";
import type { AgentProvider } from "../stores/types";

/** Logo per harness. Exhaustive over `AgentProvider`: adding a harness without
 *  an entry here is a type error rather than a silently missing icon. */
const PROVIDER_LOGOS: Record<AgentProvider, string> = {
  claude: claudeLogo,
  codex: openaiLogo,
  gemini: geminiLogo,
  kiro: kiroLogo,
  opencode: opencodeLogo,
};

/** Display name per harness. Mirrors the catalog in `emergent-core` `detect.rs`. */
const PROVIDER_LABELS: Record<AgentProvider, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  kiro: "Kiro",
  opencode: "OpenCode",
};

/**
 * Logo asset URL for a harness. Accepts null for callers that may not have
 * resolved an agent definition yet (a dangling agent id on a task, say) — not
 * because a definition can lack a provider.
 */
export function getLogoUrlForProvider(provider: AgentProvider | null | undefined): string | null {
  if (provider == null) return null;
  return PROVIDER_LOGOS[provider] ?? null;
}

/** Friendly display name (e.g. "Claude Code") for a harness. */
export function getFriendlyNameForAgent(provider: AgentProvider | null | undefined): string {
  if (provider == null) return "";
  return PROVIDER_LABELS[provider] ?? "";
}
