import { Effect, Layer } from "effect";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { RpcMethod } from "@emergent/contracts";

import {
  loadWorkspaces,
  addWorkspace,
  removeWorkspace,
  setActiveWorkspace,
  getActiveWorkspace,
} from "./overstory/workspace-manager.js";
import { createDbReaders } from "./overstory/db-readers.js";
import type { DbReaders } from "./overstory/db-readers.js";
import {
  execOv,
  slingAgent,
  stopAgent,
  nudgeAgent,
  sendMail,
  triggerMerge,
} from "./overstory/cli-bridge.js";
import {
  subscribe,
  unsubscribe,
  startPolling,
  stopPolling,
  removeClient,
} from "./overstory/subscriptions.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = Number(process.env["EMERGENT_PORT"] ?? process.env["PORT"] ?? 3773);

// ---------------------------------------------------------------------------
// DB readers cache (workspace id → DbReaders)
// ---------------------------------------------------------------------------

const readerCache = new Map<string, DbReaders>();

function getOrCreateReaders(workspaceId: string, overstoryPath: string): DbReaders {
  let readers = readerCache.get(workspaceId);
  if (!readers) {
    readers = createDbReaders(overstoryPath);
    readerCache.set(workspaceId, readers);
    startPolling(workspaceId, readers);
  }
  return readers;
}

function getActiveReaders(): { readers: DbReaders; workspaceId: string; workspacePath: string } | null {
  const ws = getActiveWorkspace();
  if (!ws) return null;
  return {
    readers: getOrCreateReaders(ws.id, ws.overstoryPath),
    workspaceId: ws.id,
    workspacePath: ws.path,
  };
}

// ---------------------------------------------------------------------------
// RPC handlers
// ---------------------------------------------------------------------------

type Params = Record<string, unknown>;

async function handleRpc(method: RpcMethod, params: Params): Promise<unknown> {
  switch (method) {
    // ----- Workspace -----
    case "workspace.list":
      return loadWorkspaces();

    case "workspace.add": {
      const p = params as { path?: string };
      if (!p.path) throw new Error("Missing required param: path");
      return addWorkspace(p.path);
    }

    case "workspace.remove": {
      const p = params as { id?: string };
      if (!p.id) throw new Error("Missing required param: id");
      removeWorkspace(p.id);
      // Clean up readers/polling
      const cached = readerCache.get(p.id);
      if (cached) {
        stopPolling(p.id);
        readerCache.delete(p.id);
      }
      return { ok: true };
    }

    case "workspace.setActive": {
      const p = params as { id?: string };
      if (!p.id) throw new Error("Missing required param: id");
      return setActiveWorkspace(p.id);
    }

    // ----- Agents -----
    case "agents.list": {
      const ctx = getActiveReaders();
      if (!ctx) return [];
      return ctx.readers.sessions();
    }

    case "agents.inspect": {
      const p = params as { name?: string };
      const ctx = getActiveReaders();
      if (!ctx) return null;
      // Return the session matching the name — full inspection requires
      // additional data that would come from the sessions DB
      const sessions = ctx.readers.sessions();
      return sessions.find((s) => s.name === p.name) ?? null;
    }

    case "agents.sling": {
      const p = params as { taskId?: string; capability?: string; runtime?: string };
      if (!p.taskId) throw new Error("Missing required param: taskId");
      if (!p.capability) throw new Error("Missing required param: capability");
      const ctx = getActiveReaders();
      if (!ctx) throw new Error("No active workspace");
      return slingAgent(ctx.workspacePath, p.taskId, p.capability, p.runtime);
    }

    case "agents.stop": {
      const p = params as { name?: string };
      if (!p.name) throw new Error("Missing required param: name");
      const ctx = getActiveReaders();
      if (!ctx) throw new Error("No active workspace");
      return stopAgent(ctx.workspacePath, p.name);
    }

    case "agents.nudge": {
      const p = params as { name?: string; message?: string };
      if (!p.name) throw new Error("Missing required param: name");
      if (!p.message) throw new Error("Missing required param: message");
      const ctx = getActiveReaders();
      if (!ctx) throw new Error("No active workspace");
      return nudgeAgent(ctx.workspacePath, p.name, p.message);
    }

    // ----- Events -----
    case "events.query": {
      const p = params as {
        agent?: string;
        runId?: string;
        type?: string;
        since?: number;
        limit?: number;
      };
      const ctx = getActiveReaders();
      if (!ctx) return [];
      return ctx.readers.events(p);
    }

    case "errors.query": {
      const ctx = getActiveReaders();
      if (!ctx) return [];
      return ctx.readers.events({ type: "error", ...(params as Params) });
    }

    // ----- Mail -----
    case "mail.list": {
      const p = params as {
        agent?: string;
        type?: string;
        read?: boolean;
        since?: number;
        limit?: number;
      };
      const ctx = getActiveReaders();
      if (!ctx) return [];
      return ctx.readers.mail(p);
    }

    case "mail.send": {
      const p = params as {
        to?: string;
        subject?: string;
        body?: string;
        type?: string;
        priority?: string;
      };
      if (!p.to) throw new Error("Missing required param: to");
      if (!p.subject) throw new Error("Missing required param: subject");
      if (!p.body) throw new Error("Missing required param: body");
      const ctx = getActiveReaders();
      if (!ctx) throw new Error("No active workspace");
      return sendMail(ctx.workspacePath, p.to, p.subject, p.body, p.type, p.priority);
    }

    case "mail.read": {
      // Mark a mail message as read — delegates to ov CLI
      const p = params as { id?: string };
      if (!p.id) throw new Error("Missing required param: id");
      const ctx = getActiveReaders();
      if (!ctx) throw new Error("No active workspace");
      return execOv(["mail", "read", p.id], ctx.workspacePath);
    }

    // ----- Merge -----
    case "merge.queue": {
      const ctx = getActiveReaders();
      if (!ctx) return [];
      return ctx.readers.mergeQueue();
    }

    case "merge.trigger": {
      const p = params as { branch?: string };
      if (!p.branch) throw new Error("Missing required param: branch");
      const ctx = getActiveReaders();
      if (!ctx) throw new Error("No active workspace");
      return triggerMerge(ctx.workspacePath, p.branch);
    }

    // ----- Metrics -----
    case "metrics.summary": {
      const ctx = getActiveReaders();
      if (!ctx) return null;
      return ctx.readers.metrics();
    }

    case "metrics.live": {
      const ctx = getActiveReaders();
      if (!ctx) return [];
      return ctx.readers.liveTokens();
    }

    // ----- Costs -----
    case "costs.query": {
      // Cost breakdown is derived from metrics DB or ov CLI
      const ctx = getActiveReaders();
      if (!ctx) return null;
      // Return live tokens grouped as a best-effort cost view
      const tokens = ctx.readers.liveTokens();
      const byAgent = new Map<string, { cost: number; tokens: number }>();
      for (const t of tokens) {
        const existing = byAgent.get(t.agent) ?? { cost: 0, tokens: 0 };
        existing.cost += (t.estimatedCost as number) ?? 0;
        existing.tokens += ((t.inputTokens as number) ?? 0) + ((t.outputTokens as number) ?? 0);
        byAgent.set(t.agent, existing);
      }
      return {
        byAgent: [...byAgent.entries()].map(([label, v]) => ({
          label,
          cost: v.cost,
          tokens: v.tokens,
        })),
        byCapability: [],
        total: [...byAgent.values()].reduce((s, v) => s + v.cost, 0),
        totalTokens: [...byAgent.values()].reduce((s, v) => s + v.tokens, 0),
      };
    }

    // ----- Runs -----
    case "runs.list": {
      const ctx = getActiveReaders();
      if (!ctx) return [];
      // Runs are typically stored in events or a dedicated table — query events for run lifecycle
      return execOv(["runs", "list", "--json"], ctx.workspacePath).then((r) => {
        try {
          return JSON.parse(r.stdout);
        } catch {
          return [];
        }
      });
    }

    case "runs.current": {
      const ctx = getActiveReaders();
      if (!ctx) return null;
      return execOv(["runs", "current", "--json"], ctx.workspacePath).then((r) => {
        try {
          return JSON.parse(r.stdout);
        } catch {
          return null;
        }
      });
    }

    // ----- Config -----
    case "config.get": {
      const ctx = getActiveReaders();
      if (!ctx) return null;
      return execOv(["config", "--json"], ctx.workspacePath).then((r) => {
        try {
          return JSON.parse(r.stdout);
        } catch {
          return null;
        }
      });
    }

    // ----- Status -----
    case "status.overview": {
      const ctx = getActiveReaders();
      if (!ctx) {
        return {
          activeAgents: 0,
          totalAgents: 0,
          unreadMail: 0,
          pendingMerges: 0,
          errorCount: 0,
          currentRun: null,
          burnRate: 0,
          totalCost: 0,
        };
      }

      const sessions = ctx.readers.sessions();
      const activeSessions = sessions.filter(
        (s) => s.state === "working" || s.state === "booting",
      );
      const unreadMail = ctx.readers.mail({ read: false });
      const pendingMerges = ctx.readers
        .mergeQueue()
        .filter((m) => m.status === "pending" || m.status === "merging");
      const errorEvents = ctx.readers.events({ type: "error", limit: 1000 });
      const metrics = ctx.readers.metrics();

      return {
        activeAgents: activeSessions.length,
        totalAgents: sessions.length,
        unreadMail: unreadMail.length,
        pendingMerges: pendingMerges.length,
        errorCount: errorEvents.length,
        currentRun: null, // Would need runs.current from CLI
        burnRate: metrics?.burnRate ?? 0,
        totalCost: metrics?.totalCost ?? 0,
      };
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Message parsing & dispatch
// ---------------------------------------------------------------------------

interface IncomingMessage {
  // RPC
  id?: string;
  method?: string;
  params?: unknown;
  // Subscribe/Unsubscribe
  type?: string;
  channels?: string[];
  workspaceId?: string;
}

function sendJson(ws: WebSocket, data: unknown): void {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(data));
    }
  } catch {
    // ignore send errors
  }
}

async function handleMessage(ws: WebSocket, raw: string): Promise<void> {
  let msg: IncomingMessage;
  try {
    msg = JSON.parse(raw) as IncomingMessage;
  } catch {
    sendJson(ws, { error: "Invalid JSON" });
    return;
  }

  // ----- Subscribe -----
  if (msg.type === "subscribe") {
    if (!msg.channels || !msg.workspaceId) {
      sendJson(ws, { error: "subscribe requires channels and workspaceId" });
      return;
    }
    subscribe(ws, msg.channels, msg.workspaceId);

    // Ensure polling is started for this workspace
    const workspaces = loadWorkspaces();
    const target = workspaces.find((w) => w.id === msg.workspaceId);
    if (target) {
      getOrCreateReaders(target.id, target.overstoryPath);
    }

    sendJson(ws, { type: "subscribed", channels: msg.channels });
    return;
  }

  // ----- Unsubscribe -----
  if (msg.type === "unsubscribe") {
    if (msg.channels) {
      unsubscribe(ws, msg.channels);
    }
    sendJson(ws, { type: "unsubscribed", channels: msg.channels ?? [] });
    return;
  }

  // ----- RPC -----
  if (msg.id && msg.method) {
    try {
      const result = await handleRpc(
        msg.method as RpcMethod,
        (msg.params as Params) ?? {},
      );
      sendJson(ws, { id: msg.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(ws, { id: msg.id, error: message });
    }
    return;
  }

  // ----- Legacy ping/pong -----
  if (msg.type === "ping") {
    sendJson(ws, { type: "pong" });
    return;
  }

  sendJson(ws, { error: "Unrecognized message format" });
}

// ---------------------------------------------------------------------------
// Effect program
// ---------------------------------------------------------------------------

const program = Effect.gen(function* () {
  const wss = new WebSocketServer({ port: PORT });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      // Clean up all polling and DB readers
      for (const [id] of readerCache) {
        stopPolling(id);
      }
      readerCache.clear();
      wss.close();
    }),
  );

  wss.on("connection", (socket: WebSocket) => {
    socket.on("message", (raw) => {
      handleMessage(socket, String(raw)).catch(() => {
        // Swallow unhandled errors from message processing
      });
    });

    socket.on("close", () => {
      removeClient(socket);
    });

    socket.on("error", () => {
      removeClient(socket);
    });
  });

  yield* Effect.log(`Emergent server listening on port ${PORT}`);
  yield* Effect.never;
});

const main = program.pipe(Effect.scoped, Effect.provide(Layer.empty));

Effect.runFork(main);

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
