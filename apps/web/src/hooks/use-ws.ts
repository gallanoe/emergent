import { useCallback, useSyncExternalStore } from "react";
import type { RpcMethod, PushChannel } from "@emergent/contracts";
import { isElectron } from "../env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConnectionStatus = "connecting" | "connected" | "disconnected";

type PushListener = (channel: string, data: unknown) => void;

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

const WS_URL =
  import.meta.env.VITE_WS_URL ??
  (isElectron
    ? ((window as unknown as Record<string, unknown>).desktopBridgeUrl as string) ??
      "ws://localhost:3773"
    : "ws://localhost:3773");

let ws: WebSocket | null = null;
let status: ConnectionStatus = "disconnected";
let rpcId = 0;
const pending = new Map<string, PendingRpc>();
const pushListeners = new Set<PushListener>();

// Reconnect state
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 500;
const MAX_RECONNECT_DELAY = 10_000;

// External store subscribers (for useSyncExternalStore)
const statusSubscribers = new Set<() => void>();

function notifyStatusChange() {
  for (const fn of statusSubscribers) fn();
}

function setStatus(next: ConnectionStatus) {
  if (status !== next) {
    status = next;
    notifyStatusChange();
  }
}

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  setStatus("connecting");

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setStatus("connected");
    reconnectDelay = 500;
  };

  ws.onclose = () => {
    setStatus("disconnected");
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after onerror, which handles reconnect
  };

  ws.onmessage = (event) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(event.data as string) as Record<string, unknown>;
    } catch {
      return;
    }

    // RPC response
    if ("id" in msg && typeof msg.id === "string") {
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        if (typeof msg.error === "string") {
          entry.reject(new Error(msg.error));
        } else {
          entry.resolve(msg.result);
        }
      }
      return;
    }

    // Push message
    if ("channel" in msg && typeof msg.channel === "string") {
      for (const listener of pushListeners) {
        listener(msg.channel, msg.data);
      }
    }
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    connect();
  }, reconnectDelay);
}

function send(data: unknown) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ---------------------------------------------------------------------------
// Public client API (usable outside React)
// ---------------------------------------------------------------------------

function sendRpc(method: RpcMethod, params?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = String(++rpcId);
    pending.set(id, { resolve, reject });
    send({ id, method, params });

    // Timeout after 30s
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }
    }, 30_000);
  });
}

function subscribe(channels: PushChannel[], workspaceId: string) {
  send({ type: "subscribe", channels, workspaceId });
}

function unsubscribe(channels: PushChannel[]) {
  send({ type: "unsubscribe", channels });
}

function onPush(listener: PushListener): () => void {
  pushListeners.add(listener);
  return () => {
    pushListeners.delete(listener);
  };
}

export const wsClient = {
  sendRpc,
  subscribe,
  unsubscribe,
  onPush,
  get status() {
    return status;
  },
  connect,
};

// Start connection eagerly
connect();

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

function subscribeToStatus(callback: () => void) {
  statusSubscribers.add(callback);
  return () => {
    statusSubscribers.delete(callback);
  };
}

function getStatus() {
  return status;
}

export function useWs() {
  const currentStatus = useSyncExternalStore(subscribeToStatus, getStatus);

  return {
    sendRpc: useCallback(sendRpc, []),
    subscribe: useCallback(subscribe, []),
    unsubscribe: useCallback(unsubscribe, []),
    onPush: useCallback(onPush, []),
    status: currentStatus,
  };
}
