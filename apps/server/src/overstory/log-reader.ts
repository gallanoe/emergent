import * as fs from "node:fs";
import * as path from "node:path";
import type { LogSession, LogChunk } from "@emergent/contracts";

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

function logsRoot(overstoryPath: string): string {
  return path.join(overstoryPath, "logs");
}

function assertWithinLogs(overstoryPath: string, resolved: string): void {
  const root = path.resolve(logsRoot(overstoryPath));
  const target = path.resolve(resolved);
  if (!target.startsWith(root + path.sep) && target !== root) {
    throw new Error("Path traversal detected");
  }
}

function sessionLogPath(
  overstoryPath: string,
  agentName: string,
  sessionId: string,
): string {
  const p = path.join(logsRoot(overstoryPath), agentName, sessionId, "session.log");
  assertWithinLogs(overstoryPath, p);
  return p;
}

// ---------------------------------------------------------------------------
// Directory timestamp parsing
// ---------------------------------------------------------------------------

/** Convert directory name like `2026-03-09T02-53-21-751Z` to ISO timestamp */
function dirNameToIso(dirName: string): string {
  // Replace the time-separator dashes back to colons and the ms dash to dot
  // Format: YYYY-MM-DDTHH-MM-SS-mmmZ → YYYY-MM-DDTHH:MM:SS.mmmZ
  const match = dirName.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
  );
  if (match) {
    return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
  }
  // Fallback: try as-is (might already be valid or close)
  return dirName;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List available log sessions, optionally filtered by agent name.
 * Returns sessions sorted by timestamp DESC (most recent first).
 */
export function listLogSessions(
  overstoryPath: string,
  agentName?: string,
): LogSession[] {
  const root = logsRoot(overstoryPath);
  if (!fs.existsSync(root)) return [];

  const agents = agentName ? [agentName] : safeReaddir(root);
  const sessions: LogSession[] = [];

  for (const agent of agents) {
    const agentDir = path.join(root, agent);
    assertWithinLogs(overstoryPath, agentDir);

    const sessionDirs = safeReaddir(agentDir);
    for (const sessionId of sessionDirs) {
      const sessionDir = path.join(agentDir, sessionId);
      assertWithinLogs(overstoryPath, sessionDir);

      let stat: fs.Stats;
      try {
        stat = fs.statSync(sessionDir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const files = safeReaddir(sessionDir);
      let sizeBytes = 0;
      for (const file of files) {
        try {
          sizeBytes += fs.statSync(path.join(sessionDir, file)).size;
        } catch {
          // skip unreadable files
        }
      }

      sessions.push({
        agentName: agent,
        sessionId,
        startedAt: dirNameToIso(sessionId),
        files,
        sizeBytes,
      } as LogSession);
    }
  }

  // Sort by startedAt DESC
  sessions.sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1));
  return sessions;
}

/**
 * Read a chunk of a log file at a precise byte offset.
 * Returns only complete lines (trailing partial line excluded from byte count).
 * Default chunk size: 64KB ≈ 1500 lines.
 */
export function readLogChunk(
  overstoryPath: string,
  agentName: string,
  sessionId: string,
  byteOffset = 0,
  maxBytes = 65_536,
): LogChunk {
  const filePath = sessionLogPath(overstoryPath, agentName, sessionId);
  const totalBytes = getLogFileSize(overstoryPath, agentName, sessionId);

  if (totalBytes === 0 || byteOffset >= totalBytes) {
    return {
      lines: [],
      byteOffset,
      bytesRead: 0,
      totalBytes,
      hasMore: false,
    } as LogChunk;
  }

  const bytesToRead = Math.min(maxBytes, totalBytes - byteOffset);
  const buffer = Buffer.alloc(bytesToRead);

  const fd = fs.openSync(filePath, "r");
  try {
    const actualRead = fs.readSync(fd, buffer, 0, bytesToRead, byteOffset);
    const raw = buffer.subarray(0, actualRead).toString("utf-8");

    // Only return complete lines
    const lastNewline = raw.lastIndexOf("\n");
    if (lastNewline === -1) {
      // No complete line in this chunk
      return {
        lines: [],
        byteOffset,
        bytesRead: 0,
        totalBytes,
        hasMore: byteOffset + actualRead < totalBytes,
      } as LogChunk;
    }

    const completeText = raw.substring(0, lastNewline + 1);
    const completeBytesRead = Buffer.byteLength(completeText, "utf-8");
    const lines = completeText.split("\n").filter((l) => l.length > 0);

    return {
      lines,
      byteOffset,
      bytesRead: completeBytesRead,
      totalBytes,
      hasMore: byteOffset + completeBytesRead < totalBytes,
    } as LogChunk;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Get the size of a log file in bytes.
 */
export function getLogFileSize(
  overstoryPath: string,
  agentName: string,
  sessionId: string,
): number {
  const filePath = sessionLogPath(overstoryPath, agentName, sessionId);
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((n) => !n.startsWith("."));
  } catch {
    return [];
  }
}
