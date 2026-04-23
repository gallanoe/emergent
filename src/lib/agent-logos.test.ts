import { describe, it, expect } from "vitest";
import {
  getLogoUrlForProvider,
  inferProviderIdFromCli,
  getLogoUrlForAgent,
} from "./agent-logos";
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

  it("infers provider id from known spawn commands", () => {
    expect(
      inferProviderIdFromCli("bunx @zed-industries/claude-agent-acp"),
    ).toBe("claude");
    expect(inferProviderIdFromCli("bunx @zed-industries/codex-acp")).toBe("codex");
    expect(inferProviderIdFromCli("gemini --experimental-acp")).toBe("gemini");
    expect(inferProviderIdFromCli("kiro-cli acp")).toBe("kiro");
    expect(inferProviderIdFromCli("opencode acp")).toBe("opencode");
  });

  it("getLogoUrlForAgent prefers provider then cli", () => {
    expect(getLogoUrlForAgent("claude", "nope")).toBe(claudeLogo);
    expect(getLogoUrlForAgent(null, "bunx @zed-industries/claude-agent-acp")).toBe(
      claudeLogo,
    );
    expect(getLogoUrlForAgent(null, "unknown-bin")).toBeNull();
  });
});
