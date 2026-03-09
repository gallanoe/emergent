import { describe, expect, it } from "vitest";

describe("routes", () => {
  it("root route module exports Route", async () => {
    const mod = await import("../src/routes/__root.tsx");
    expect(mod.Route).toBeDefined();
  });

  it("index route module exports Route", async () => {
    const mod = await import("../src/routes/index.tsx");
    expect(mod.Route).toBeDefined();
  });
});
