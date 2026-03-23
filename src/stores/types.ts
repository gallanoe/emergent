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
  role: "assistant" | "thinking" | "user" | "tool-group" | "system";
  content: string;
  toolCalls?: DisplayToolCall[];
  timestamp: string;
}

export type AgentStatus = "initializing" | "idle" | "working" | "error";

export interface DisplayAgent {
  id: string;
  swarmId: string;
  cli: string;
  name: string;
  status: AgentStatus;
  preview: string;
  updatedAt: string;
  messages: DisplayMessage[];
  activeToolCalls: DisplayToolCall[];
  queuedMessage: string | null;
  configOptions: ConfigOption[];
  errorMessage?: string;
}

export interface DisplaySwarm {
  id: string;
  name: string;
  collapsed: boolean;
  agents: DisplayAgent[];
}

export interface MenuItem {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  separator?: boolean;
}
