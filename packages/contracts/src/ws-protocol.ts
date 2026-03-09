import { Schema } from "effect";

/** RPC request envelope */
export class WsRequest extends Schema.Class<WsRequest>("WsRequest")({
  id: Schema.String,
  method: Schema.String,
  params: Schema.Unknown,
}) {}

/** RPC response envelope */
export class WsResponse extends Schema.Class<WsResponse>("WsResponse")({
  id: Schema.String,
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
}) {}

/** Push event envelope (server → client) */
export class WsPush extends Schema.Class<WsPush>("WsPush")({
  channel: Schema.String,
  data: Schema.Unknown,
}) {}

/** Subscription request */
export class WsSubscribe extends Schema.Class<WsSubscribe>("WsSubscribe")({
  type: Schema.Literal("subscribe"),
  channels: Schema.Array(Schema.String),
  workspaceId: Schema.String,
}) {}

/** Unsubscription request */
export class WsUnsubscribe extends Schema.Class<WsUnsubscribe>(
  "WsUnsubscribe",
)({
  type: Schema.Literal("unsubscribe"),
  channels: Schema.Array(Schema.String),
}) {}

/** All known RPC method names */
export const RpcMethods = [
  "workspace.list",
  "workspace.add",
  "workspace.remove",
  "workspace.setActive",
  "agents.list",
  "agents.inspect",
  "agents.sling",
  "agents.stop",
  "agents.nudge",
  "events.query",
  "errors.query",
  "mail.list",
  "mail.send",
  "mail.read",
  "merge.queue",
  "merge.trigger",
  "metrics.summary",
  "metrics.live",
  "costs.query",
  "runs.list",
  "runs.current",
  "config.get",
  "status.overview",
] as const;

export type RpcMethod = (typeof RpcMethods)[number];

/** All known push channel names */
export const PushChannels = [
  "agents.changed",
  "events.new",
  "mail.new",
  "merge.changed",
  "metrics.snapshot",
] as const;

export type PushChannel = (typeof PushChannels)[number];
