import { Schema } from "effect";
import { Run } from "./run.js";

export class StatusOverview extends Schema.Class<StatusOverview>(
  "StatusOverview",
)({
  activeAgents: Schema.Number,
  totalAgents: Schema.Number,
  unreadMail: Schema.Number,
  pendingMerges: Schema.Number,
  errorCount: Schema.Number,
  currentRun: Schema.NullOr(Run),
  burnRate: Schema.Number,
  totalCost: Schema.Number,
}) {}
