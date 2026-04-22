import { describe, it, expect } from "vitest";
import { getCliLogo, resolveCliLogoKey } from "./agent-logos";
import claudeLogo from "../assets/claude.svg";

describe("agent-logos", () => {
  it("resolves simple ids", () => {
    expect(resolveCliLogoKey("claude")).toBe("claude");
    expect(resolveCliLogoKey("gemini")).toBe("gemini");
    expect(resolveCliLogoKey("  Codex  ")).toBe("codex");
  });

  it("ignores path prefixes and command flags", () => {
    expect(resolveCliLogoKey("claude --acp")).toBe("claude");
    expect(resolveCliLogoKey("/usr/local/bin/gemini run")).toBe("gemini");
  });

  it("maps hyphenated agent slugs to provider logos", () => {
    expect(resolveCliLogoKey("claude-agent-acp")).toBe("claude");
    expect(resolveCliLogoKey("opencode-cli")).toBe("opencode");
  });

  it("returns null for unknown CLIs", () => {
    expect(resolveCliLogoKey("unknown-tool")).toBeNull();
  });

  it("getCliLogo returns asset URL when resolvable", () => {
    expect(getCliLogo("claude --acp")).toBe(claudeLogo);
  });
});
