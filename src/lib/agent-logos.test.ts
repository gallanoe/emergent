import { describe, it, expect } from "vitest";
import { getLogoUrlForProvider, getFriendlyNameForAgent } from "./agent-logos";
import type { AgentProvider } from "../stores/types";
import claudeLogo from "../assets/claude.svg";

describe("agent-logos", () => {
  it("returns logo only for explicit provider ids", () => {
    expect(getLogoUrlForProvider("claude")).toBe(claudeLogo);
    expect(getLogoUrlForProvider("gemini")).toBeTruthy();
  });

  it("returns null when no definition resolved", () => {
    expect(getLogoUrlForProvider(null)).toBeNull();
    expect(getLogoUrlForProvider(undefined)).toBeNull();
  });

  it("resolves friendly names from provider ids", () => {
    expect(getFriendlyNameForAgent("claude")).toBe("Claude Code");
    expect(getFriendlyNameForAgent("codex")).toBe("Codex");
    expect(getFriendlyNameForAgent(null)).toBe("");
  });

  /// TypeScript rejects an unknown harness at compile time, but its types are
  /// erased — a malformed IPC payload can still deliver one at run time.
  it("degrades rather than throwing on a value that escapes the type system", () => {
    const rogue = "kodex" as AgentProvider;
    expect(getLogoUrlForProvider(rogue)).toBeNull();
    expect(getFriendlyNameForAgent(rogue)).toBe("");
  });
});
