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

export interface DisplayMessage {
  id: string;
  role: "assistant" | "thinking" | "user" | "tool-group";
  content: string;
  toolCalls?: DisplayToolCall[];
  timestamp: string;
}

export type AgentStatus = "idle" | "working" | "error";

export interface DisplayAgent {
  id: string;
  swarmId: string;
  cli: string;
  name: string;
  status: AgentStatus;
  preview: string;
  updatedAt: string;
  messages: DisplayMessage[];
}

export interface DisplaySwarm {
  id: string;
  name: string;
  collapsed: boolean;
  agents: DisplayAgent[];
}
