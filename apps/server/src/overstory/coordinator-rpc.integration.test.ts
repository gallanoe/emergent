import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { createCoordinatorLifecycle } from "./coordinator-lifecycle.js";
import type { CoordinatorOps } from "./coordinator-lifecycle.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomPort(): number {
  return 10_000 + Math.floor(Math.random() * 50_000);
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function sendRpc(
  ws: WebSocket,
  method: string,
  params?: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => reject(new Error("RPC timeout")), 5_000);

    const handler = (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          id?: string;
          result?: unknown;
          error?: string;
        };
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.off("message", handler);
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.result);
        }
      } catch {
        // Ignore non-matching messages
      }
    };

    ws.on("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function waitForPush(
  ws: WebSocket,
  channel: string,
  timeoutMs = 5_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Push timeout")),
      timeoutMs,
    );

    const handler = (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          channel?: string;
          data?: unknown;
        };
        if (msg.channel === channel) {
          clearTimeout(timeout);
          ws.off("message", handler);
          resolve(msg.data);
        }
      } catch {
        // Ignore
      }
    };

    ws.on("message", handler);
  });
}

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

describe("coordinator RPC integration", () => {
  let port: number;
  let wss: WebSocketServer;
  let client: WebSocket;

  const mockOps: CoordinatorOps = {
    status: vi.fn().mockResolvedValue({ running: false }),
    start: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    stop: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    hasConfig: vi.fn().mockReturnValue(true),
  };

  let pushMessages: Array<{ channel: string; data: unknown }> = [];

  const lifecycle = createCoordinatorLifecycle(mockOps, (_wsId, info) => {
    const msg = { channel: "coordinator.stateChanged", data: info };
    pushMessages.push(msg);

    // Broadcast to all connected clients
    const payload = JSON.stringify(msg);
    for (const c of wss.clients) {
      if (c.readyState === WebSocket.OPEN) {
        c.send(payload);
      }
    }
  });

  beforeAll(async () => {
    port = randomPort();
    wss = new WebSocketServer({ port });

    wss.on("connection", (socket) => {
      socket.on("message", async (raw) => {
        let msg: { id?: string; method?: string; params?: unknown };
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }

        if (!msg.id || !msg.method) return;

        try {
          let result: unknown;
          switch (msg.method) {
            case "coordinator.status":
              result = lifecycle.getCoordinatorState("test-ws");
              break;
            case "coordinator.start":
              result = await lifecycle.manualStart("test-ws", "/test");
              break;
            case "coordinator.stop":
              result = await lifecycle.manualStop("test-ws", "/test");
              break;
            default:
              socket.send(
                JSON.stringify({ id: msg.id, error: "Unknown method" }),
              );
              return;
          }
          socket.send(JSON.stringify({ id: msg.id, result }));
        } catch (err) {
          socket.send(
            JSON.stringify({
              id: msg.id,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });
    });

    client = await connectWs(port);
  });

  afterAll(() => {
    lifecycle.shutdownAll();
    client?.close();
    wss?.close();
  });

  it("returns idle state via coordinator.status", async () => {
    const result = (await sendRpc(client, "coordinator.status")) as {
      state: string;
    };
    expect(result.state).toBe("idle");
  });

  it("starts coordinator via coordinator.start", async () => {
    // Mock status to return running after start
    vi.mocked(mockOps.status).mockResolvedValue({ running: true });

    const result = (await sendRpc(client, "coordinator.start")) as {
      state: string;
      startedByUs: boolean;
    };
    expect(result.state).toBe("running");
    expect(result.startedByUs).toBe(true);
    expect(mockOps.start).toHaveBeenCalled();
  });

  it("receives push message on state change", async () => {
    vi.mocked(mockOps.status).mockResolvedValue({ running: false });

    const pushPromise = waitForPush(client, "coordinator.stateChanged");
    // Trigger a state change via stop
    await sendRpc(client, "coordinator.stop");
    const pushData = await pushPromise;
    expect(pushData).toEqual(
      expect.objectContaining({ state: expect.any(String) }),
    );
  });
});
