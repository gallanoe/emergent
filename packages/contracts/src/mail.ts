import { Schema } from "effect";

export const MailType = Schema.Literal(
  "task",
  "status",
  "question",
  "response",
);
export type MailType = typeof MailType.Type;

export const MailPriority = Schema.Literal("low", "normal", "high", "urgent");
export type MailPriority = typeof MailPriority.Type;

export class MailMessage extends Schema.Class<MailMessage>("MailMessage")({
  id: Schema.String,
  from: Schema.String,
  to: Schema.String,
  subject: Schema.String,
  body: Schema.String,
  type: MailType,
  priority: MailPriority,
  read: Schema.Boolean,
  timestamp: Schema.Number,
  threadId: Schema.NullOr(Schema.String),
}) {}
