import type { Component } from "svelte";

/** Shared display types used by all components.
 *  Both mock and real agent stores produce data in these shapes. */

/** The kind of tool action, matching ACP ToolKind. */
export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "other";

/** Structured content from a tool call. */
export type ToolCallContentItem =
  | { type: "text"; text: string }
  | { type: "diff"; path: string; oldText: string | null; newText: string }
  | { type: "terminal"; terminalId: string; output?: string; exitCode?: number | null };

export interface DisplayToolCall {
  id: string;
  name: string;
  kind: ToolKind;
  status: "pending" | "in_progress" | "completed" | "failed";
  locations: string[];
  content: ToolCallContentItem[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface ConfigSelectOption {
  value: string;
  name: string;
}

export interface ConfigSelectGroup {
  label: string;
  options: ConfigSelectOption[];
}

export interface ConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: string;
  current_value: string;
  options: ConfigSelectOption[] | ConfigSelectGroup[];
}

export interface DisplayMessage {
  id: string;
  role: "assistant" | "thinking" | "user" | "tool-group" | "system" | "nudge";
  content: string;
  toolCalls?: DisplayToolCall[];
  timestamp: string;
  nudgeCount?: number;
}

export interface NudgeDeliveredPayload {
  thread_id: string;
  count: number;
}

export interface TopologyChangedPayload {
  thread_id_a: string;
  thread_id_b: string;
}

export type ThreadProcessStatus = "initializing" | "idle" | "working" | "error";

// ── Agent/Thread remodel types ─────────────────────────────

export interface AgentDefinition {
  id: string;
  workspace_id: string;
  name: string;
  role?: string;
  cli: string;
}

export interface ThreadSummary {
  id: string;
  agent_id: string;
  status: string;
  workspace_id: string;
  acp_session_id: string | null;
}

export interface ThreadMapping {
  thread_id: string;
  agent_definition_id: string;
  acp_session_id: string | null;
  task_id?: string | null;
}

export interface DisplayThread {
  id: string;
  agentId: string;
  workspaceId: string;
  cli: string;
  name: string;
  status: ThreadProcessStatus | "dead";
  processStatus: ThreadProcessStatus | "dead";
  preview: string;
  messages: DisplayMessage[];
  activeToolCalls: DisplayToolCall[];
  queuedMessage: string | null;
  configOptions: ConfigOption[];
  hasManagementPermissions: boolean;
  errorMessage?: string;
  role?: string;
  updatedAt: string;
  stopReason: string | null;
  taskId: string | null;
}

export interface DisplayAgentDefinition {
  id: string;
  name: string;
  role?: string;
  cli: string;
  threads: DisplayThread[];
}

export interface DisplayTask {
  id: string;
  title: string;
  description: string;
  status: "pending" | "working" | "completed" | "failed";
  parent_id: string | null;
  blocker_ids: string[];
  agent_id: string;
  session_id: string | null;
  workspace_id: string;
  created_at: string;
}

export interface TaskCreatedPayload {
  task: DisplayTask;
}

export interface TaskUpdatedPayload {
  task: DisplayTask;
}

export interface AgentCreatedPayload {
  definition_id: string;
}

export interface AgentDeletedPayload {
  definition_id: string;
}

export type ActiveView =
  | "overview"
  | "swarm"
  | "agent-threads"
  | "agent-chat"
  | "agent-settings"
  | "create-agent"
  | "settings"
  | "app-settings"
  | "terminal"
  | "tasks";

export type ContainerStatus =
  | { state: "stopped" }
  | { state: "building" }
  | { state: "running" }
  | { state: "error"; message: string };

export interface WorkspaceSummary {
  id: string;
  name: string;
  container_status: ContainerStatus;
  agent_count: number;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
  container_id: string | null;
  container_status: ContainerStatus;
}

export type ContainerRuntimeKind = "docker" | "podman";

export interface ContainerRuntimePreference {
  selected_runtime: ContainerRuntimeKind;
}

export interface ContainerRuntimeStatus {
  selected_runtime: ContainerRuntimeKind;
  available: boolean;
  version: string | null;
  message?: string | null;
}

export interface WorkspaceStatusChangePayload {
  workspace_id: string;
  status: ContainerStatus;
}

export interface DisplayWorkspace {
  id: string;
  name: string;
  collapsed: boolean;
  containerStatus: ContainerStatus;
  agentDefinitions: DisplayAgentDefinition[];
}

/** @deprecated Use DisplayWorkspace instead */
export type DisplaySwarm = DisplayWorkspace;

export interface SystemMessagePayload {
  thread_id: string;
  content: string;
}

export interface MenuItem {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  separator?: boolean;
  icon?: Component;
}
