import { Schema } from "effect";

export const WorkspaceStatus = Schema.Literal(
  "connected",
  "disconnected",
  "error",
);
export type WorkspaceStatus = typeof WorkspaceStatus.Type;

export class Workspace extends Schema.Class<Workspace>("Workspace")({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  overstoryPath: Schema.String,
  active: Schema.Boolean,
  status: WorkspaceStatus,
}) {}
