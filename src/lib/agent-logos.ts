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
};

/** Returns the logo URL for a given CLI id, or null for unknown CLIs. */
export function getCliLogo(cli: string): string | null {
  return CLI_LOGOS[cli.toLowerCase()] ?? null;
}
