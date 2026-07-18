import { describe, it, expect } from "vitest";
import { getLogoUrlForProvider, getFriendlyNameForAgent } from "./agent-logos";
import claudeLogo from "../assets/claude.svg";

describe("agent-logos", () => {
  it("returns logo only for explicit provider ids", () => {
    expect(getLogoUrlForProvider("claude")).toBe(claudeLogo);
    expect(getLogoUrlForProvider("gemini")).toBeTruthy();
  });

  it("returns null for missing or unknown provider", () => {
    expect(getLogoUrlForProvider(null)).toBeNull();
    expect(getLogoUrlForProvider("")).toBeNull();
    expect(getLogoUrlForProvider("some-random-cli")).toBeNull();
  });

  it("resolves friendly names from provider ids", () => {
    expect(getFriendlyNameForAgent("claude")).toBe("Claude Code");
    expect(getFriendlyNameForAgent("codex")).toBe("Codex");
  });

  it("returns an empty friendly name for missing or unknown provider", () => {
    expect(getFriendlyNameForAgent(null)).toBe("");
    expect(getFriendlyNameForAgent("not-an-agent")).toBe("");
  });
});
