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

function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function parseValue<T>(value: unknown): T | null {
  if (value == null) return null;
  try {
    return value as T;
  } catch {
    return null;
  }
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

export function parseAgentsToolContent(toolCall: DisplayToolCall): EmergentAgentSummary[] {
  return parseJson<EmergentAgentSummary[]>(firstTextContent(toolCall)) ?? [];
}

export function parseTasksToolContent(toolCall: DisplayToolCall): DisplayTask[] {
  return parseJson<DisplayTask[]>(firstTextContent(toolCall)) ?? [];
}

export function parseCreateTaskToolContent(toolCall: DisplayToolCall): CreateTaskToolResult | null {
  return (
    parseValue<CreateTaskToolResult>(toolCall.rawOutput) ??
    parseJson<CreateTaskToolResult>(firstTextContent(toolCall))
  );
}

export function parseCompleteTaskToolContent(
  toolCall: DisplayToolCall,
): CompleteTaskToolResult | null {
  return (
    parseValue<CompleteTaskToolResult>(toolCall.rawOutput) ??
    parseJson<CompleteTaskToolResult>(firstTextContent(toolCall))
  );
}

export function parseCreateTaskToolInput(toolCall: DisplayToolCall): CreateTaskToolInput | null {
  return parseValue<CreateTaskToolInput>(toolCall.rawInput);
}

export function parseUpdateTaskToolInput(toolCall: DisplayToolCall): UpdateTaskToolInput | null {
  return parseValue<UpdateTaskToolInput>(toolCall.rawInput);
}

export function parseUpdateTaskToolContent(toolCall: DisplayToolCall): UpdateTaskToolResult | null {
  return (
    parseValue<UpdateTaskToolResult>(toolCall.rawOutput) ??
    parseJson<UpdateTaskToolResult>(firstTextContent(toolCall))
  );
}
