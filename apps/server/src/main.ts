import { Effect, Layer } from "effect";
import { WebSocketServer } from "ws";

const PORT = Number(process.env["EMERGENT_PORT"] ?? process.env["PORT"] ?? 3773);

const program = Effect.gen(function* () {
  const wss = new WebSocketServer({ port: PORT });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      wss.close();
    }),
  );

  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: string };
        if (msg.type === "ping") {
          socket.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // ignore malformed messages
      }
    });
  });

  yield* Effect.log(`Server listening on port ${PORT}`);
  yield* Effect.never;
});

const main = program.pipe(Effect.scoped, Effect.provide(Layer.empty));

Effect.runFork(main);

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
