import { Schema } from "effect";

export const MergeStatus = Schema.Literal(
  "pending",
  "merging",
  "merged",
  "conflict",
  "failed",
);
export type MergeStatus = typeof MergeStatus.Type;

export class MergeEntry extends Schema.Class<MergeEntry>("MergeEntry")({
  id: Schema.String,
  agent: Schema.String,
  branch: Schema.String,
  status: MergeStatus,
  filesModified: Schema.Number,
  resolutionTier: Schema.NullOr(Schema.String),
  timestamp: Schema.Number,
}) {}
