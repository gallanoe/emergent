import { Schema } from "effect";

export class OvConfig extends Schema.Class<OvConfig>("OvConfig")({
  projectName: Schema.NullOr(Schema.String),
  defaultRuntime: Schema.NullOr(Schema.String),
  capabilities: Schema.Array(Schema.String),
  runtimes: Schema.Array(Schema.String),
}) {}
