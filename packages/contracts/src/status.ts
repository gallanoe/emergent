import { Schema } from "effect";
import { Run } from "./run.js";

export const CoordinatorStates = [
  "idle",
  "checking",
  "starting",
  "running",
  "stopping",
  "stopped",
  "error",
  "disabled",
] as const;

export type CoordinatorState = (typeof CoordinatorStates)[number];

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
  coordinatorState: Schema.optional(Schema.String),
  coordinatorError: Schema.optional(Schema.String),
}) {}
