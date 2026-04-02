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
  agent_id: string;
  count: number;
}

export interface MailboxMessage {
  sender: string;
  timestamp: string;
  body: string;
}

export interface SwarmMessagePayload {
  from_agent_id: string;
  from_agent_name: string;
  to_agent_id: string;
  to_agent_name: string;
  body: string;
  timestamp: string;
}

export interface SwarmMessageLogEntry {
  id: string;
  fromName: string;
  toName: string;
  preview: string;
  timestamp: string;
}

export interface TopologyChangedPayload {
  agent_id_a: string;
  agent_id_b: string;
}

export type AgentStatus = "initializing" | "idle" | "working" | "error";

export interface DisplayAgent {
  id: string;
  workspaceId: string;
  cli: string;
  name: string;
  status: AgentStatus;
  preview: string;
  updatedAt: string;
  messages: DisplayMessage[];
  activeToolCalls: DisplayToolCall[];
  queuedMessage: string | null;
  configOptions: ConfigOption[];
  hasManagementPermissions: boolean;
  errorMessage?: string;
  role?: string;
}

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

export interface DockerStatus {
  docker_available: boolean;
  docker_version: string | null;
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
  agents: DisplayAgent[];
}

/** @deprecated Use DisplayWorkspace instead */
export type DisplaySwarm = DisplayWorkspace;

export interface SystemMessagePayload {
  agent_id: string;
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
