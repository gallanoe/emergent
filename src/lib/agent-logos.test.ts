import { describe, it, expect } from "vitest";
import { getLogoUrlForProvider } from "./agent-logos";
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
});
