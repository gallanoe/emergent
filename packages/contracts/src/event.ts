import { Schema } from "effect";

export const EventLevel = Schema.Literal("info", "warn", "error");
export type EventLevel = typeof EventLevel.Type;

export class StoredEvent extends Schema.Class<StoredEvent>("StoredEvent")({
  id: Schema.String,
  type: Schema.String,
  agent: Schema.NullOr(Schema.String),
  runId: Schema.NullOr(Schema.String),
  level: EventLevel,
  detail: Schema.String,
  timestamp: Schema.Number,
}) {}
