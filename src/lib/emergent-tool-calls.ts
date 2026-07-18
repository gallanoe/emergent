import type { DisplayTask, DisplayToolCall } from "../stores/types";

export type EmergentToolName =
  | "create_task"
  | "list_tasks"
  | "complete_task"
  | "update_task"
  | "list_agents";

export interface EmergentAgentSummary {
  id: string;
  name: string;
}

export interface CreateTaskToolResult {
  task_id: string;
}

export interface CreateTaskToolInput {
  title: string;
  description: string;
  agent_id: string;
  blocker_ids?: string[];
}

export interface CompleteTaskToolResult {
  task_id: string;
  status: string;
}

export interface UpdateTaskToolInput {
  description: string;
}

export interface UpdateTaskToolResult {
  task_id: string;
  status: string;
}

function firstTextContent(toolCall: DisplayToolCall): string | null {
  const text = toolCall.content.find((item) => item.type === "text");
  return text?.type === "text" ? text.text : null;
}

/**
 * Tool payloads come from an external agent, so their shape is a claim rather
 * than a fact — every parse below is gated on a runtime guard.
 */
type Guard<T> = (value: unknown) => value is T;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

/**
 * The Rust side marks `parent_id` and `session_id` `skip_serializing_if =
 * "Option::is_none"`, so on the wire they are *absent* rather than `null` — a
 * pending task carries no `session_id` key at all. `DisplayTask` types them as
 * `string | null`, so accept both spellings of "missing" here and normalize to
 * `null` in `toDisplayTask` below.
 */
function isAbsentOrString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || isString(value);
}

const TASK_STATUSES: ReadonlySet<string> = new Set(["pending", "working", "completed", "failed"]);

const isCreateTaskToolResult: Guard<CreateTaskToolResult> = (
  value,
): value is CreateTaskToolResult => isRecord(value) && isString(value.task_id);

const isCompleteTaskToolResult: Guard<CompleteTaskToolResult> = (
  value,
): value is CompleteTaskToolResult =>
  isRecord(value) && isString(value.task_id) && isString(value.status);

const isUpdateTaskToolResult: Guard<UpdateTaskToolResult> = (
  value,
): value is UpdateTaskToolResult =>
  isRecord(value) && isString(value.task_id) && isString(value.status);

const isCreateTaskToolInput: Guard<CreateTaskToolInput> = (value): value is CreateTaskToolInput =>
  isRecord(value) &&
  isString(value.title) &&
  isString(value.description) &&
  isString(value.agent_id) &&
  // `blocker_ids` is `Option<Vec<String>>` on the Rust side; an agent's client
  // may omit it or send an explicit null.
  (value.blocker_ids === undefined ||
    value.blocker_ids === null ||
    isStringArray(value.blocker_ids));

const isUpdateTaskToolInput: Guard<UpdateTaskToolInput> = (value): value is UpdateTaskToolInput =>
  isRecord(value) && isString(value.description);

const isEmergentAgentSummary: Guard<EmergentAgentSummary> = (
  value,
): value is EmergentAgentSummary => isRecord(value) && isString(value.id) && isString(value.name);

/** Extra wire fields (`summary`, `creator_thread_id`) are ignored, not rejected. */
function toDisplayTask(value: unknown): DisplayTask | null {
  if (
    !isRecord(value) ||
    !isString(value.id) ||
    !isString(value.title) ||
    !isString(value.description) ||
    !isString(value.status) ||
    !TASK_STATUSES.has(value.status) ||
    !isAbsentOrString(value.parent_id) ||
    !isStringArray(value.blocker_ids) ||
    !isString(value.agent_id) ||
    !isAbsentOrString(value.session_id) ||
    !isString(value.workspace_id) ||
    !isString(value.created_at)
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    description: value.description,
    status: value.status as DisplayTask["status"],
    parent_id: value.parent_id ?? null,
    blocker_ids: value.blocker_ids,
    agent_id: value.agent_id,
    session_id: value.session_id ?? null,
    workspace_id: value.workspace_id,
    created_at: value.created_at,
  };
}

function parseJson<T>(text: string | null, guard: Guard<T>): T | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return guard(parsed) ? parsed : null;
}

/**
 * Malformed entries are dropped rather than failing the whole list, so one bad
 * element from an agent does not blank an otherwise useful table.
 */
function parseJsonArray<T>(text: string | null, toItem: (value: unknown) => T | null): T[] {
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const items: T[] = [];
  for (const entry of parsed) {
    const item = toItem(entry);
    if (item !== null) items.push(item);
  }
  return items;
}

function fromGuard<T>(guard: Guard<T>): (value: unknown) => T | null {
  return (value) => (guard(value) ? value : null);
}

function parseValue<T>(value: unknown, guard: Guard<T>): T | null {
  return guard(value) ? value : null;
}

export function getEmergentToolName(name: string): EmergentToolName | null {
  const lower = name.toLowerCase();
  if (lower.endsWith("create_task")) return "create_task";
  if (lower.endsWith("list_tasks")) return "list_tasks";
  if (lower.endsWith("complete_task")) return "complete_task";
  if (lower.endsWith("update_task")) return "update_task";
  if (lower.endsWith("list_agents")) return "list_agents";
  return null;
}

export function emergentToolDisplayName(name: EmergentToolName): string {
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function parseAgentsToolContent(toolCall: DisplayToolCall): EmergentAgentSummary[] {
  return parseJsonArray(firstTextContent(toolCall), fromGuard(isEmergentAgentSummary));
}

export function parseTasksToolContent(toolCall: DisplayToolCall): DisplayTask[] {
  return parseJsonArray(firstTextContent(toolCall), toDisplayTask);
}

export function parseCreateTaskToolContent(toolCall: DisplayToolCall): CreateTaskToolResult | null {
  return (
    parseValue(toolCall.rawOutput, isCreateTaskToolResult) ??
    parseJson(firstTextContent(toolCall), isCreateTaskToolResult)
  );
}

export function parseCompleteTaskToolContent(
  toolCall: DisplayToolCall,
): CompleteTaskToolResult | null {
  return (
    parseValue(toolCall.rawOutput, isCompleteTaskToolResult) ??
    parseJson(firstTextContent(toolCall), isCompleteTaskToolResult)
  );
}

export function parseCreateTaskToolInput(toolCall: DisplayToolCall): CreateTaskToolInput | null {
  return parseValue(toolCall.rawInput, isCreateTaskToolInput);
}

export function parseUpdateTaskToolInput(toolCall: DisplayToolCall): UpdateTaskToolInput | null {
  return parseValue(toolCall.rawInput, isUpdateTaskToolInput);
}

export function parseUpdateTaskToolContent(toolCall: DisplayToolCall): UpdateTaskToolResult | null {
  return (
    parseValue(toolCall.rawOutput, isUpdateTaskToolResult) ??
    parseJson(firstTextContent(toolCall), isUpdateTaskToolResult)
  );
}
