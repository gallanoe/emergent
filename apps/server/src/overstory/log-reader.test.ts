import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { listLogSessions, readLogChunk, getLogFileSize } from "./log-reader.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tempDir: string;

function ovPath(): string {
  return tempDir;
}

function createLogSession(
  agentName: string,
  sessionId: string,
  content: string,
): string {
  const sessionDir = path.join(tempDir, "logs", agentName, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const logFile = path.join(sessionDir, "session.log");
  fs.writeFileSync(logFile, content);
  return logFile;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("log-reader", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "ov-log-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("listLogSessions", () => {
    it("returns empty array when logs directory does not exist", () => {
      const result = listLogSessions(ovPath());
      expect(result).toEqual([]);
    });

    it("lists sessions sorted by timestamp DESC", () => {
      createLogSession("agent-a", "2026-03-09T02-53-21-751Z", "line1\n");
      createLogSession("agent-a", "2026-03-10T10-00-00-000Z", "line2\nline3\n");
      createLogSession("agent-b", "2026-03-08T01-00-00-000Z", "x\n");

      const sessions = listLogSessions(ovPath());
      expect(sessions).toHaveLength(3);
      // Most recent first
      expect(sessions[0]!.agentName).toBe("agent-a");
      expect(sessions[0]!.sessionId).toBe("2026-03-10T10-00-00-000Z");
      expect(sessions[0]!.startedAt).toBe("2026-03-10T10:00:00.000Z");

      expect(sessions[1]!.agentName).toBe("agent-a");
      expect(sessions[1]!.startedAt).toBe("2026-03-09T02:53:21.751Z");

      expect(sessions[2]!.agentName).toBe("agent-b");
    });

    it("filters by agent name", () => {
      createLogSession("agent-a", "2026-03-09T02-53-21-751Z", "data\n");
      createLogSession("agent-b", "2026-03-10T10-00-00-000Z", "data\n");

      const sessions = listLogSessions(ovPath(), "agent-a");
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.agentName).toBe("agent-a");
    });

    it("includes file list and size", () => {
      createLogSession("agent-a", "2026-03-09T02-53-21-751Z", "hello world\n");

      const sessions = listLogSessions(ovPath());
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.files).toContain("session.log");
      expect(sessions[0]!.sizeBytes).toBe(Buffer.byteLength("hello world\n"));
    });
  });

  describe("readLogChunk", () => {
    it("reads from offset 0", () => {
      const content = "line1\nline2\nline3\n";
      createLogSession("agent-a", "s1", content);

      const chunk = readLogChunk(ovPath(), "agent-a", "s1", 0);
      expect(chunk.lines).toEqual(["line1", "line2", "line3"]);
      expect(chunk.byteOffset).toBe(0);
      expect(chunk.bytesRead).toBe(Buffer.byteLength(content));
      expect(chunk.hasMore).toBe(false);
    });

    it("reads from mid-file offset", () => {
      const content = "line1\nline2\nline3\n";
      createLogSession("agent-a", "s1", content);

      // Offset past "line1\n" (6 bytes)
      const chunk = readLogChunk(ovPath(), "agent-a", "s1", 6);
      expect(chunk.lines).toEqual(["line2", "line3"]);
      expect(chunk.byteOffset).toBe(6);
      expect(chunk.hasMore).toBe(false);
    });

    it("reads from end of file returns empty", () => {
      const content = "line1\n";
      createLogSession("agent-a", "s1", content);

      const chunk = readLogChunk(ovPath(), "agent-a", "s1", 6);
      expect(chunk.lines).toEqual([]);
      expect(chunk.bytesRead).toBe(0);
      expect(chunk.hasMore).toBe(false);
    });

    it("excludes trailing partial line from chunk boundary", () => {
      const content = "short\nthis is a longer line\n";
      createLogSession("agent-a", "s1", content);

      // Read only 10 bytes — "short\nthis" — partial line at end
      const chunk = readLogChunk(ovPath(), "agent-a", "s1", 0, 10);
      expect(chunk.lines).toEqual(["short"]);
      // bytesRead should be 6 (up to and including the newline after "short")
      expect(chunk.bytesRead).toBe(6);
      expect(chunk.hasMore).toBe(true);
    });

    it("handles empty file", () => {
      createLogSession("agent-a", "s1", "");

      const chunk = readLogChunk(ovPath(), "agent-a", "s1", 0);
      expect(chunk.lines).toEqual([]);
      expect(chunk.bytesRead).toBe(0);
      expect(chunk.totalBytes).toBe(0);
      expect(chunk.hasMore).toBe(false);
    });

    it("reports hasMore correctly for large files", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line-${i}`).join("\n") + "\n";
      createLogSession("agent-a", "s1", lines);

      // Read small chunk
      const chunk = readLogChunk(ovPath(), "agent-a", "s1", 0, 50);
      expect(chunk.hasMore).toBe(true);
      expect(chunk.lines.length).toBeGreaterThan(0);
    });
  });

  describe("getLogFileSize", () => {
    it("returns file size in bytes", () => {
      const content = "hello world\n";
      createLogSession("agent-a", "s1", content);

      const size = getLogFileSize(ovPath(), "agent-a", "s1");
      expect(size).toBe(Buffer.byteLength(content));
    });

    it("returns 0 for non-existent file", () => {
      const size = getLogFileSize(ovPath(), "no-agent", "no-session");
      expect(size).toBe(0);
    });
  });

  describe("path traversal guard", () => {
    it("throws on path traversal in agentName", () => {
      expect(() =>
        readLogChunk(ovPath(), "../../../etc", "s1", 0),
      ).toThrow("Path traversal detected");
    });

    it("throws on path traversal in sessionId", () => {
      expect(() =>
        readLogChunk(ovPath(), "agent-a", "../../etc/passwd", 0),
      ).toThrow("Path traversal detected");
    });
  });
});
