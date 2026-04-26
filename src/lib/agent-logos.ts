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

/**
 * When `provider` was never stored (legacy rows) or is unknown, map the spawn
 * command to the same stable ids used in {@link getLogoUrlForProvider}.
 * Kept in sync with `KNOWN_AGENTS` command shapes in `emergent-core` `detect.rs`.
 */
export function inferProviderIdFromCli(cli: string | null | undefined): string | null {
  if (cli == null) return null;
  const c = cli.trim().toLowerCase();
  if (c === "") return null;

  if (c.includes("claude-agent-acp") || c.includes("@zed-industries/claude-agent")) {
    return "claude";
  }
  if (c.includes("codex-acp") || c.includes("@zed-industries/codex")) {
    return "codex";
  }
  if (c.includes("kiro-cli")) {
    return "kiro";
  }
  if (c.includes("opencode") && c.includes("acp")) {
    return "opencode";
  }
  if (c.includes("gemini") && (c.includes("experimental-acp") || c.includes(" acp"))) {
    return "gemini";
  }

  // Short legacy / shorthand commands used in tests and older data
  if (c === "claude" || c === "codex" || c === "gemini" || c === "kiro" || c === "opencode") {
    return c;
  }

  return null;
}

/** Logo URL using explicit `provider`, falling back to inference from `cli`. */
export function getLogoUrlForAgent(
  provider: string | null | undefined,
  cli: string | null | undefined,
): string | null {
  return getLogoUrlForProvider(provider) ?? getLogoUrlForProvider(inferProviderIdFromCli(cli));
}

/** Friendly display name (e.g. "Claude Code") resolved from `provider`,
 * falling back to inference from `cli`, then to the raw `cli` string. */
export function getFriendlyNameForAgent(
  provider: string | null | undefined,
  cli: string | null | undefined,
): string {
  const id = provider?.trim().toLowerCase() || inferProviderIdFromCli(cli);
  if (id && PROVIDER_LABELS[id]) return PROVIDER_LABELS[id];
  return cli?.trim() || "";
}
