import { Schema } from "effect";

export const AgentState = Schema.Literal(
  "booting",
  "working",
  "stalled",
  "zombie",
  "completed",
);
export type AgentState = typeof AgentState.Type;

export class AgentSession extends Schema.Class<AgentSession>("AgentSession")({
  name: Schema.String,
  capability: Schema.String,
  state: AgentState,
  taskId: Schema.NullOr(Schema.String),
  runId: Schema.NullOr(Schema.String),
  runtime: Schema.NullOr(Schema.String),
  startedAt: Schema.Number,
  duration: Schema.Number,
  pid: Schema.NullOr(Schema.Number),
  tmuxPane: Schema.NullOr(Schema.String),
}) {}

export class TokenUsage extends Schema.Class<TokenUsage>("TokenUsage")({
  input: Schema.Number,
  output: Schema.Number,
  cache: Schema.Number,
  estimatedCost: Schema.Number,
  model: Schema.String,
}) {}

export class ToolUsageStat extends Schema.Class<ToolUsageStat>(
  "ToolUsageStat",
)({
  name: Schema.String,
  callCount: Schema.Number,
  avgDuration: Schema.Number,
  maxDuration: Schema.Number,
}) {}

export class RecentToolCall extends Schema.Class<RecentToolCall>(
  "RecentToolCall",
)({
  tool: Schema.String,
  args: Schema.String,
  result: Schema.String,
  duration: Schema.Number,
  timestamp: Schema.Number,
}) {}

export class AgentInspection extends Schema.Class<AgentInspection>(
  "AgentInspection",
)({
  name: Schema.String,
  capability: Schema.String,
  state: AgentState,
  taskId: Schema.NullOr(Schema.String),
  runId: Schema.NullOr(Schema.String),
  runtime: Schema.NullOr(Schema.String),
  startedAt: Schema.Number,
  duration: Schema.Number,
  pid: Schema.NullOr(Schema.Number),
  tmuxPane: Schema.NullOr(Schema.String),
  tokenUsage: TokenUsage,
  toolUsage: Schema.Array(ToolUsageStat),
  recentToolCalls: Schema.Array(RecentToolCall),
}) {}
