import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { useLogSessions, useLogChunk } from "../../hooks/use-overstory";
import { useLogTail } from "../../hooks/use-log-tail";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { useUiStore } from "../../stores/ui-store";
import { wsClient } from "../../hooks/use-ws";
import type { AgentState, LogChunk as LogChunkType } from "@emergent/contracts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function lineClass(line: string): string {
  if (line.includes("] ERROR") || line.includes("] error")) return "text-red-400";
  if (line.includes("] WARN") || line.includes("] warn")) return "text-amber-400";
  return "text-neutral-400";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LogViewerProps {
  agentName: string;
  agentState?: AgentState;
}

export function LogViewer({ agentName, agentState }: LogViewerProps) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const followMode = useUiStore((s) => s.logFollowMode);
  const setFollowMode = useUiStore((s) => s.setLogFollowMode);

  // Session selector
  const { data: sessions } = useLogSessions(agentName, activeWorkspaceId);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // Auto-select most recent session
  useEffect(() => {
    if (sessions && sessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId(sessions[0]!.sessionId);
    }
  }, [sessions, selectedSessionId]);

  const selectedSession = useMemo(
    () => sessions?.find((s) => s.sessionId === selectedSessionId),
    [sessions, selectedSessionId],
  );

  // Initial chunk: read last 64KB
  const initialOffset = useMemo(() => {
    if (!selectedSession) return 0;
    return Math.max(0, selectedSession.sizeBytes - 65_536);
  }, [selectedSession]);

  const { data: initialChunk, isLoading: chunkLoading } = useLogChunk(
    agentName,
    selectedSessionId ?? "",
    initialOffset,
    activeWorkspaceId,
  );

  // "Load older" chunks
  const [olderChunks, setOlderChunks] = useState<string[][]>([]);
  const [olderNextOffset, setOlderNextOffset] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Reset older chunks when session changes
  useEffect(() => {
    setOlderChunks([]);
    setOlderNextOffset(null);
  }, [selectedSessionId]);

  // Compute whether we can load older
  const canLoadOlder = initialOffset > 0 && olderNextOffset !== 0;

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !selectedSessionId) return;
    setLoadingOlder(true);

    const offset = olderNextOffset ?? initialOffset;
    const readFrom = Math.max(0, offset - 65_536);
    const readSize = offset - readFrom;

    try {
      const result = await wsClient.sendRpc(
        "logs.read" as Parameters<typeof wsClient.sendRpc>[0],
        {
          agentName,
          sessionId: selectedSessionId,
          byteOffset: readFrom,
          maxBytes: readSize,
        },
      ) as LogChunkType;

      setOlderChunks((prev) => [[...result.lines], ...prev]);
      setOlderNextOffset(readFrom);
    } finally {
      setLoadingOlder(false);
    }
  }, [agentName, selectedSessionId, initialOffset, olderNextOffset, loadingOlder]);

  // Live tail
  const isAgentActive = agentState === "working" || agentState === "booting";
  const tail = useLogTail(agentName, selectedSessionId);

  useEffect(() => {
    if (followMode && isAgentActive && selectedSessionId) {
      tail.start();
    } else {
      tail.stop();
    }
  }, [followMode, isAgentActive, selectedSessionId]);

  // Scroll container ref
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  // Auto-scroll when follow mode is on and new content arrives
  const allLines = useMemo(() => {
    const lines: string[] = [];
    for (const chunk of olderChunks) {
      lines.push(...chunk);
    }
    if (initialChunk?.lines) {
      lines.push(...initialChunk.lines);
    }
    lines.push(...tail.lines);
    return lines;
  }, [olderChunks, initialChunk?.lines, tail.lines]);

  useEffect(() => {
    if (followMode && scrollRef.current && !userScrolledUp.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allLines, followMode]);

  // Initial scroll to bottom
  useEffect(() => {
    if (scrollRef.current && initialChunk?.lines) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [initialChunk?.lines]);

  // Detect manual scroll up to disable follow mode
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (!atBottom && followMode) {
      userScrolledUp.current = true;
      setFollowMode(false);
    } else if (atBottom && !followMode) {
      userScrolledUp.current = false;
      setFollowMode(true);
    }
  }, [followMode, setFollowMode]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-neutral-800">
        {/* Session selector */}
        <select
          className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm text-neutral-200 font-mono"
          value={selectedSessionId ?? ""}
          onChange={(e) => {
            setSelectedSessionId(e.target.value);
            setFollowMode(true);
            userScrolledUp.current = false;
          }}
        >
          {sessions?.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {new Date(s.startedAt).toLocaleString()} ({formatFileSize(s.sizeBytes)})
            </option>
          ))}
        </select>

        <div className="flex-1" />

        {/* Follow mode toggle */}
        <button
          onClick={() => {
            const next = !followMode;
            setFollowMode(next);
            userScrolledUp.current = !next;
            if (next && scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
            followMode
              ? "bg-cyan-900/40 text-cyan-300 border border-cyan-800"
              : "bg-neutral-800 text-neutral-400 border border-neutral-700 hover:text-neutral-200"
          }`}
        >
          <ChevronDown className="h-3 w-3" />
          Follow
        </button>

        {tail.isActive && (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
            Tailing
          </span>
        )}
      </div>

      {/* Log content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-neutral-950 p-4 font-mono text-xs leading-relaxed"
      >
        {chunkLoading && (
          <div className="flex items-center justify-center py-8 text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Loading logs...
          </div>
        )}

        {!chunkLoading && allLines.length === 0 && (
          <div className="text-neutral-600 text-center py-8">
            No log data available.
          </div>
        )}

        {/* Load older button */}
        {canLoadOlder && !chunkLoading && (
          <div className="text-center pb-2">
            <button
              onClick={loadOlder}
              disabled={loadingOlder}
              className="text-xs text-neutral-500 hover:text-neutral-300 underline disabled:opacity-50"
            >
              {loadingOlder ? "Loading..." : "Load older logs"}
            </button>
          </div>
        )}

        {/* Lines */}
        {allLines.map((line, i) => (
          <div key={i} className={lineClass(line)}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
