import { describe, it, expect, beforeEach } from "vitest";
import { mockMetrics } from "./mock-metrics.svelte";

describe("mockMetrics", () => {
  beforeEach(() => {
    mockMetrics.clear();
  });

  it("returns zeros for tokenFor on unseen agent", () => {
    expect(mockMetrics.tokenFor("unseen")).toEqual({
      input: 0,
      output: 0,
      cost: 0,
    });
  });

  it("updates reads after seedAgent", () => {
    mockMetrics.seedAgent("a1", { input: 10, output: 5, cost: 1.5 });
    expect(mockMetrics.tokenFor("a1")).toEqual({
      input: 10,
      output: 5,
      cost: 1.5,
    });
  });

  it("returns default 12-sample runtime for runtimeFor on unseen workspace", () => {
    const r = mockMetrics.runtimeFor("unknown-ws");
    expect(r.cpuSeries).toHaveLength(12);
    expect(r.memSeries).toHaveLength(12);
    expect(r.netSeries).toHaveLength(12);
    expect(r.cpuPct).toBe(14);
  });

  it("clear empties both maps", () => {
    mockMetrics.seedAgent("a1", { input: 1, output: 1, cost: 0.1 });
    mockMetrics.seedWorkspace("ws1", {
      cpuPct: 1,
      memMb: 1,
      memLimitMb: 1,
      netKbps: 1,
      cpuSeries: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      memSeries: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      netSeries: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    });
    mockMetrics.clear();
    expect(mockMetrics.tokenFor("a1").input).toBe(0);
    const r = mockMetrics.runtimeFor("ws1");
    expect(r.cpuPct).toBe(14);
  });
});
