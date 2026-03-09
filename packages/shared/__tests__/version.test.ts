import { describe, expect, it } from "vitest";
import { version } from "../src/version.ts";

describe("version", () => {
  it("is a non-empty string matching semver-like pattern", () => {
    expect(version).toBeTruthy();
    expect(typeof version).toBe("string");
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
