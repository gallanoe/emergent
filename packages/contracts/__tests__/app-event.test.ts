import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import { Effect, Schema } from "effect";
import { AppEvent } from "../src/index.ts";

describe("AppEvent", () => {
  it.effect("round-trips encode then decode", () =>
    Effect.gen(function* () {
      const event = new AppEvent({ type: "test", timestamp: Date.now() });
      const encoded = yield* Schema.encode(AppEvent)(event);
      const decoded = yield* Schema.decode(AppEvent)(encoded);
      expect(decoded.type).toBe(event.type);
      expect(decoded.timestamp).toBe(event.timestamp);
    }),
  );
});
