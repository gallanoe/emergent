import { Schema } from "effect";

/** Represents a single log session directory */
export class LogSession extends Schema.Class<LogSession>("LogSession")({
  agentName: Schema.String,
  sessionId: Schema.String,
  startedAt: Schema.String,
  files: Schema.Array(Schema.String),
  sizeBytes: Schema.Number,
}) {}

/** A chunk of log file content read at a specific byte offset */
export class LogChunk extends Schema.Class<LogChunk>("LogChunk")({
  lines: Schema.Array(Schema.String),
  byteOffset: Schema.Number,
  bytesRead: Schema.Number,
  totalBytes: Schema.Number,
  hasMore: Schema.Boolean,
}) {}
