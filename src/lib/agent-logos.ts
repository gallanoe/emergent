import claudeLogo from "../assets/claude.svg";
import openaiLogo from "../assets/openai.svg";
import geminiLogo from "../assets/gemini.svg";
import kiroLogo from "../assets/kiro.svg";
import opencodeLogo from "../assets/opencode.svg";

export const AGENT_LOGOS: Record<string, string> = {
  "Claude Code": claudeLogo,
  Codex: openaiLogo,
  Gemini: geminiLogo,
  Kiro: kiroLogo,
  OpenCode: opencodeLogo,
};

const CLI_LOGOS: Record<string, string> = {
  claude: claudeLogo,
  codex: openaiLogo,
  gemini: geminiLogo,
  kiro: kiroLogo,
  opencode: opencodeLogo,
};

/** Returns the logo URL for a given CLI id, or null for unknown CLIs. */
export function getCliLogo(cli: string): string | null {
  return CLI_LOGOS[cli.toLowerCase()] ?? null;
}

const AGENT_LOGOS_BY_CLI: Record<string, string> = {
  claude: claudeLogo,
  "claude-agent-acp": claudeLogo,
  "bunx @zed-industries/claude-agent-acp": claudeLogo,
  codex: openaiLogo,
  "codex-acp": openaiLogo,
  "bunx @zed-industries/codex-acp": openaiLogo,
  gemini: geminiLogo,
  "kiro-cli": kiroLogo,
  opencode: opencodeLogo,
};

export function getAgentLogo(name?: string, cli?: string): string | undefined {
  if (name && AGENT_LOGOS[name]) return AGENT_LOGOS[name];
  if (cli && AGENT_LOGOS_BY_CLI[cli]) return AGENT_LOGOS_BY_CLI[cli];
  return undefined;
}
