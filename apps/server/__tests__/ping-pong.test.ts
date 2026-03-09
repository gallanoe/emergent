import { describe, it, expect, afterAll } from "vitest";
import { WebSocketServer } from "ws";
import WebSocket from "ws";

describe("ping-pong", () => {
  let wss: WebSocketServer;
  let port: number;

  afterAll(() => {
    return new Promise<void>((resolve) => {
      if (wss) wss.close(() => resolve());
      else resolve();
    });
  });

  it("responds with pong when sent ping", async () => {
    // Start server on random port
    wss = new WebSocketServer({ port: 0 });
    const addr = wss.address();
    port = typeof addr === "object" && addr !== null ? addr.port : 0;

    wss.on("connection", (socket) => {
      socket.on("message", (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as { type?: string };
          if (msg.type === "ping") {
            socket.send(JSON.stringify({ type: "pong" }));
          }
        } catch {
          // ignore
        }
      });
    });

    // Connect client
    const ws = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => ws.on("open", resolve));

    // Send ping, expect pong
    const response = await new Promise<string>((resolve) => {
      ws.on("message", (data) => resolve(String(data)));
      ws.send(JSON.stringify({ type: "ping" }));
    });

    const parsed = JSON.parse(response) as { type: string };
    expect(parsed.type).toBe("pong");

    ws.close();
  });
});
