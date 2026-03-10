import { useCallback, useEffect, useRef, useState } from "react";
import { wsClient } from "./use-ws";

const MAX_TAIL_LINES = 5_000;

interface LogTailResult {
  lines: string[];
  isActive: boolean;
  start: () => void;
  stop: () => void;
}

export function useLogTail(
  agentName: string,
  sessionId: string | null,
): LogTailResult {
  const [lines, setLines] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(false);
  const activeRef = useRef(false);
  const unsubRef = useRef<(() => void) | null>(null);

  const start = useCallback(() => {
    if (!sessionId || activeRef.current) return;
    activeRef.current = true;
    setIsActive(true);
    setLines([]);

    // Subscribe to push channel
    unsubRef.current = wsClient.onPush((channel, data) => {
      if (channel !== "logs.tail") return;
      const payload = data as {
        agentName: string;
        sessionId: string;
        lines: string[];
      };
      if (payload.agentName !== agentName || payload.sessionId !== sessionId) return;

      setLines((prev) => {
        const next = [...prev, ...payload.lines];
        if (next.length > MAX_TAIL_LINES) {
          return next.slice(next.length - MAX_TAIL_LINES);
        }
        return next;
      });
    });

    // Start tail on server
    wsClient.sendRpc("logs.tail.start" as Parameters<typeof wsClient.sendRpc>[0], {
      agentName,
      sessionId,
    });
  }, [agentName, sessionId]);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setIsActive(false);

    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    if (sessionId) {
      wsClient.sendRpc("logs.tail.stop" as Parameters<typeof wsClient.sendRpc>[0], {
        agentName,
        sessionId,
      });
    }
  }, [agentName, sessionId]);

  // Cleanup on unmount or session change
  useEffect(() => {
    return () => {
      if (activeRef.current) {
        activeRef.current = false;
        if (unsubRef.current) {
          unsubRef.current();
          unsubRef.current = null;
        }
        if (sessionId) {
          wsClient.sendRpc("logs.tail.stop" as Parameters<typeof wsClient.sendRpc>[0], {
            agentName,
            sessionId,
          });
        }
      }
    };
  }, [agentName, sessionId]);

  return { lines, isActive, start, stop };
}
