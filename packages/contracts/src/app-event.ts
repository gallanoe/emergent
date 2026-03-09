import { Schema } from "effect";

export class AppEvent extends Schema.Class<AppEvent>("AppEvent")({
  type: Schema.String,
  timestamp: Schema.Number,
}) {}
