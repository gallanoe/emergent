import type { WebSocket } from "ws";
import type { DbReaders } from "./db-readers.js";
import type { PushChannel } from "@emergent/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChannelState {
  lastHash: string;
}

interface WorkspacePolling {
  dbReaders: DbReaders;
  timers: Map<PushChannel, ReturnType<typeof setInterval>>;
  lastState: Map<PushChannel, ChannelState>;
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

/** channel key → set of subscribed WebSocket connections */
const subscriptions = new Map<string, Set<WebSocket>>();

/** workspaceId → polling state */
const pollingState = new Map<string, WorkspacePolling>();

/** ws → set of channel keys the ws is subscribed to (for cleanup) */
const wsChannels = new Map<WebSocket, Set<string>>();

// ---------------------------------------------------------------------------
// Poll intervals per channel (ms)
// ---------------------------------------------------------------------------

/** Poll intervals for DB-backed channels. coordinator.stateChanged is push-only. */
const POLL_INTERVALS: Partial<Record<PushChannel, number>> = {
  "agents.changed": 2_000,
  "events.new": 1_000,
  "mail.new": 2_000,
  "merge.changed": 3_000,
  "metrics.snapshot": 5_000,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function channelKey(workspaceId: string, channel: PushChannel): string {
  return `${workspaceId}:${channel}`;
}

/** Simple hash for change detection — JSON stringification is cheap for small payloads */
function quickHash(data: unknown): string {
  return JSON.stringify(data);
}

function broadcast(key: string, channel: string, data: unknown): void {
  const subs = subscriptions.get(key);
  if (!subs || subs.size === 0) return;

  const msg = JSON.stringify({ channel, data });
  for (const ws of subs) {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg);
      } else {
        // Clean up dead connections
        subs.delete(ws);
      }
    } catch {
      subs.delete(ws);
    }
  }
}

// ---------------------------------------------------------------------------
// Pollers
// ---------------------------------------------------------------------------

function pollChannel(
  workspaceId: string,
  channel: PushChannel,
  readers: DbReaders,
  lastState: Map<PushChannel, ChannelState>,
): void {
  let data: unknown;

  switch (channel) {
    case "agents.changed":
      data = readers.sessions();
      break;
    case "events.new":
      data = readers.events({ limit: 50 });
      break;
    case "mail.new":
      data = readers.mail({ limit: 50 });
      break;
    case "merge.changed":
      data = readers.mergeQueue();
      break;
    case "metrics.snapshot":
      data = readers.metrics();
      break;
    default:
      return;
  }

  const hash = quickHash(data);
  const prev = lastState.get(channel);

  if (!prev || prev.lastHash !== hash) {
    lastState.set(channel, { lastHash: hash });
    broadcast(channelKey(workspaceId, channel), channel, data);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function subscribe(
  ws: WebSocket,
  channels: readonly string[],
  workspaceId: string,
): void {
  // Track which channels this ws is subscribed to
  if (!wsChannels.has(ws)) {
    wsChannels.set(ws, new Set());
  }
  const tracked = wsChannels.get(ws)!;

  for (const ch of channels) {
    const key = channelKey(workspaceId, ch as PushChannel);

    if (!subscriptions.has(key)) {
      subscriptions.set(key, new Set());
    }
    subscriptions.get(key)!.add(ws);
    tracked.add(key);
  }
}

export function unsubscribe(ws: WebSocket, channels?: readonly string[]): void {
  const tracked = wsChannels.get(ws);
  if (!tracked) return;

  if (channels) {
    // Unsubscribe from specific channels (across all workspaces they may be in)
    for (const key of tracked) {
      const ch = key.split(":").slice(1).join(":");
      if (channels.includes(ch)) {
        subscriptions.get(key)?.delete(ws);
        tracked.delete(key);
      }
    }
  } else {
    // Unsubscribe from everything (e.g. on disconnect)
    for (const key of tracked) {
      subscriptions.get(key)?.delete(ws);
    }
    wsChannels.delete(ws);
  }
}

export function startPolling(workspaceId: string, dbReaders: DbReaders): void {
  // Don't double-start
  if (pollingState.has(workspaceId)) return;

  const timers = new Map<PushChannel, ReturnType<typeof setInterval>>();
  const lastState = new Map<PushChannel, ChannelState>();

  for (const [channel, interval] of Object.entries(POLL_INTERVALS) as [
    PushChannel,
    number,
  ][]) {
    const timer = setInterval(() => {
      pollChannel(workspaceId, channel, dbReaders, lastState);
    }, interval);

    // Allow the process to exit even if timers are running
    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }

    timers.set(channel, timer);
  }

  pollingState.set(workspaceId, { dbReaders, timers, lastState });
}

export function stopPolling(workspaceId: string): void {
  const state = pollingState.get(workspaceId);
  if (!state) return;

  for (const timer of state.timers.values()) {
    clearInterval(timer);
  }

  state.dbReaders.close();
  pollingState.delete(workspaceId);
}

export function removeClient(ws: WebSocket): void {
  unsubscribe(ws);
}

/**
 * Broadcast a message to ALL connected sockets (not workspace-scoped).
 * Used for coordinator state changes which apply to the active workspace globally.
 */
export function broadcastToAll(channel: string, data: unknown): void {
  const msg = JSON.stringify({ channel, data });
  // Collect all unique WebSockets across all subscription keys
  const seen = new Set<WebSocket>();
  for (const subs of subscriptions.values()) {
    for (const ws of subs) {
      if (!seen.has(ws)) {
        seen.add(ws);
        try {
          if (ws.readyState === ws.OPEN) {
            ws.send(msg);
          }
        } catch {
          // ignore send errors
        }
      }
    }
  }
  // Also notify any tracked ws that may not be in subscriptions
  for (const ws of wsChannels.keys()) {
    if (!seen.has(ws)) {
      try {
        if (ws.readyState === ws.OPEN) {
          ws.send(msg);
        }
      } catch {
        // ignore send errors
      }
    }
  }
}
