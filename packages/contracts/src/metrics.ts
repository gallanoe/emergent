import { Schema } from "effect";

export class MetricsSummary extends Schema.Class<MetricsSummary>(
  "MetricsSummary",
)({
  totalTokens: Schema.Number,
  totalCost: Schema.Number,
  burnRate: Schema.Number,
  activeSessions: Schema.Number,
}) {}

export class LiveTokenUsage extends Schema.Class<LiveTokenUsage>(
  "LiveTokenUsage",
)({
  agent: Schema.String,
  model: Schema.String,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheTokens: Schema.Number,
  estimatedCost: Schema.Number,
  timestamp: Schema.Number,
}) {}

export class CostEntry extends Schema.Class<CostEntry>("CostEntry")({
  label: Schema.String,
  cost: Schema.Number,
  tokens: Schema.Number,
}) {}

export class CostBreakdown extends Schema.Class<CostBreakdown>(
  "CostBreakdown",
)({
  byAgent: Schema.Array(CostEntry),
  byCapability: Schema.Array(CostEntry),
  total: Schema.Number,
  totalTokens: Schema.Number,
}) {}
