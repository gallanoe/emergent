import { Database } from "bun:sqlite";
import * as path from "node:path";
import * as fs from "node:fs";
import type {
  AgentSession,
  StoredEvent,
  MailMessage,
  MergeEntry,
  MetricsSummary,
  LiveTokenUsage,
} from "@emergent/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventFilters {
  agent?: string;
  runId?: string;
  type?: string;
  since?: number;
  limit?: number;
}

export interface MailFilters {
  agent?: string;
  type?: string;
  read?: boolean;
  since?: number;
  limit?: number;
}

export interface DbReaders {
  sessions(): AgentSession[];
  events(filters?: EventFilters): StoredEvent[];
  mail(filters?: MailFilters): MailMessage[];
  mergeQueue(): MergeEntry[];
  metrics(): MetricsSummary | null;
  liveTokens(): LiveTokenUsage[];
  close(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openDb(dbPath: string): Database | null {
  if (!fs.existsSync(dbPath)) return null;
  try {
    const db = new Database(dbPath, { readonly: true });
    db.exec("PRAGMA journal_mode = WAL;");
    return db;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDbReaders(overstoryPath: string): DbReaders {
  const dbDir = overstoryPath;
  let sessionsDb = openDb(path.join(dbDir, "sessions.db"));
  let eventsDb = openDb(path.join(dbDir, "events.db"));
  let mailDb = openDb(path.join(dbDir, "mail.db"));
  let mergeDb = openDb(path.join(dbDir, "merge-queue.db"));
  let metricsDb = openDb(path.join(dbDir, "metrics.db"));

  return {
    // -----------------------------------------------------------------------
    // Sessions
    // -----------------------------------------------------------------------
    sessions(): AgentSession[] {
      if (!sessionsDb) return [];
      try {
        const rows = sessionsDb
          .query(
            `SELECT name, capability, state, task_id AS taskId, run_id AS runId,
                    runtime, started_at AS startedAt, duration, pid, tmux_pane AS tmuxPane
             FROM sessions
             ORDER BY started_at DESC`,
          )
          .all() as AgentSession[];
        return rows;
      } catch {
        return [];
      }
    },

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------
    events(filters: EventFilters = {}): StoredEvent[] {
      if (!eventsDb) return [];
      try {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (filters.agent) {
          conditions.push("agent = ?");
          params.push(filters.agent);
        }
        if (filters.runId) {
          conditions.push("run_id = ?");
          params.push(filters.runId);
        }
        if (filters.type) {
          conditions.push("type = ?");
          params.push(filters.type);
        }
        if (filters.since != null) {
          conditions.push("timestamp > ?");
          params.push(filters.since);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const limit = filters.limit ?? 200;

        const rows = eventsDb
          .query(
            `SELECT id, type, agent, run_id AS runId, level, detail, timestamp
             FROM events
             ${where}
             ORDER BY timestamp DESC
             LIMIT ?`,
          )
          .all(...params, limit) as StoredEvent[];
        return rows;
      } catch {
        return [];
      }
    },

    // -----------------------------------------------------------------------
    // Mail
    // -----------------------------------------------------------------------
    mail(filters: MailFilters = {}): MailMessage[] {
      if (!mailDb) return [];
      try {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (filters.agent) {
          conditions.push("(\"from\" = ? OR \"to\" = ?)");
          params.push(filters.agent, filters.agent);
        }
        if (filters.type) {
          conditions.push("type = ?");
          params.push(filters.type);
        }
        if (filters.read != null) {
          conditions.push("read = ?");
          params.push(filters.read ? 1 : 0);
        }
        if (filters.since != null) {
          conditions.push("timestamp > ?");
          params.push(filters.since);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const limit = filters.limit ?? 200;

        const rows = mailDb
          .query(
            `SELECT id, "from", "to", subject, body, type, priority, read,
                    timestamp, thread_id AS threadId
             FROM mail
             ${where}
             ORDER BY timestamp DESC
             LIMIT ?`,
          )
          .all(...params, limit) as MailMessage[];
        return rows;
      } catch {
        return [];
      }
    },

    // -----------------------------------------------------------------------
    // Merge queue
    // -----------------------------------------------------------------------
    mergeQueue(): MergeEntry[] {
      if (!mergeDb) return [];
      try {
        const rows = mergeDb
          .query(
            `SELECT id, agent, branch, status, files_modified AS filesModified,
                    resolution_tier AS resolutionTier, timestamp
             FROM merge_queue
             ORDER BY timestamp DESC`,
          )
          .all() as MergeEntry[];
        return rows;
      } catch {
        return [];
      }
    },

    // -----------------------------------------------------------------------
    // Metrics
    // -----------------------------------------------------------------------
    metrics(): MetricsSummary | null {
      if (!metricsDb) return null;
      try {
        const row = metricsDb
          .query(
            `SELECT total_tokens AS totalTokens, total_cost AS totalCost,
                    burn_rate AS burnRate, active_sessions AS activeSessions
             FROM metrics_summary
             ORDER BY rowid DESC
             LIMIT 1`,
          )
          .get() as MetricsSummary | undefined;
        return row ?? null;
      } catch {
        return null;
      }
    },

    // -----------------------------------------------------------------------
    // Live token usage (per-agent)
    // -----------------------------------------------------------------------
    liveTokens(): LiveTokenUsage[] {
      if (!metricsDb) return [];
      try {
        const rows = metricsDb
          .query(
            `SELECT agent, model, input_tokens AS inputTokens,
                    output_tokens AS outputTokens, cache_tokens AS cacheTokens,
                    estimated_cost AS estimatedCost, timestamp
             FROM live_token_usage
             ORDER BY timestamp DESC`,
          )
          .all() as LiveTokenUsage[];
        return rows;
      } catch {
        return [];
      }
    },

    // -----------------------------------------------------------------------
    // Close
    // -----------------------------------------------------------------------
    close(): void {
      for (const db of [sessionsDb, eventsDb, mailDb, mergeDb, metricsDb]) {
        try {
          db?.close();
        } catch {
          // ignore
        }
      }
      sessionsDb = null;
      eventsDb = null;
      mailDb = null;
      mergeDb = null;
      metricsDb = null;
    },
  };
}
