import { Schema } from "effect";

export const RunStatus = Schema.Literal("active", "completed", "failed");
export type RunStatus = typeof RunStatus.Type;

export class Run extends Schema.Class<Run>("Run")({
  id: Schema.String,
  status: RunStatus,
  startedAt: Schema.Number,
  endedAt: Schema.NullOr(Schema.Number),
  agentCount: Schema.Number,
  duration: Schema.Number,
}) {}
