/** Shared display types used by all components.
 *  Both mock and real agent stores produce data in these shapes. */

export interface DisplayToolCall {
  id: string;
  name: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  content?: string;
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
