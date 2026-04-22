import { describe, it, expect } from "vitest";
import { normalizeThreadSummaryStatus } from "./types";

describe("normalizeThreadSummaryStatus", () => {
  it("preserves known thread status strings", () => {
    expect(normalizeThreadSummaryStatus("initializing")).toBe("initializing");
    expect(normalizeThreadSummaryStatus("idle")).toBe("idle");
    expect(normalizeThreadSummaryStatus("working")).toBe("working");
    expect(normalizeThreadSummaryStatus("error")).toBe("error");
    expect(normalizeThreadSummaryStatus("dead")).toBe("dead");
  });

  it("maps unknown status strings to dead", () => {
    expect(normalizeThreadSummaryStatus("unknown")).toBe("dead");
    expect(normalizeThreadSummaryStatus("")).toBe("dead");
  });
});
