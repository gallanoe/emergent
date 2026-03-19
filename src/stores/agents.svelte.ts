import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  DisplayAgent,
  DisplayMessage,
  DisplayToolCall,
} from "./types";

// ── Internal state per agent ────────────────────────────────────

interface AgentConnection {
  id: string;
  swarmId: string;
  cli: string;
  status: "initializing" | "idle" | "working" | "error";
  messages: DisplayMessage[];
  activeToolCalls: Map<string, DisplayToolCall>;
  stopReason: string | null;
}

// ── Event payloads from Rust ────────────────────────────────────

interface MessageChunkPayload {
  agent_id: string;
  content: string;
}

interface ToolCallUpdatePayload {
  agent_id: string;
  tool_call_id: string;
  title: string;
  status: string;
  content?: string;
}

interface PromptCompletePayload {
  agent_id: string;
  stop_reason: string;
}

interface AgentErrorPayload {
  agent_id: string;
  message: string;
}

interface StatusChangePayload {
  agent_id: string;
  status: string;
}

interface AgentInfo {
  name: string;
  binary: string;
  path: string;
}

// ── Store ───────────────────────────────────────────────────────

function createAgentStore() {
  let agents = $state<Map<string, AgentConnection>>(new Map());

  function getAgent(agentId: string): AgentConnection | undefined {
    return agents.get(agentId);
  }

  // ── Message assembly ──────────────────────────────────────────

  function handleMessageChunk(payload: MessageChunkPayload) {
    const agent = agents.get(payload.agent_id);
    if (!agent) return;

    const lastMsg = agent.messages.at(-1);
    if (lastMsg && lastMsg.role === "assistant" && !lastMsg.toolCalls?.length) {
      // Append to existing in-progress assistant message
      lastMsg.content += payload.content;
    } else {
      // Start a new assistant message
      agent.messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content: payload.content,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
      });
    }
  }

  function handleToolCallUpdate(payload: ToolCallUpdatePayload) {
    const agent = agents.get(payload.agent_id);
    if (!agent) return;

    const tc: DisplayToolCall = {
      id: payload.tool_call_id,
      name: payload.title,
      status: payload.status as DisplayToolCall["status"],
      ...(payload.content !== undefined ? { content: payload.content } : {}),
    };

    agent.activeToolCalls.set(payload.tool_call_id, tc);

    // When a tool call completes/fails, check if all active tool calls are done
    if (payload.status === "completed" || payload.status === "failed") {
      const allDone = [...agent.activeToolCalls.values()].every(
        (t) => t.status === "completed" || t.status === "failed",
      );

      if (allDone && agent.activeToolCalls.size > 0) {
        // Flush active tool calls into a tool-group message
        const toolCalls = [...agent.activeToolCalls.values()];
        agent.messages.push({
          id: crypto.randomUUID(),
          role: "tool-group",
          content: "",
          toolCalls,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
        });
        agent.activeToolCalls.clear();
      }
    }
  }

  function handlePromptComplete(payload: PromptCompletePayload) {
    const agent = agents.get(payload.agent_id);
    if (!agent) return;

    agent.stopReason = payload.stop_reason;
    if (agent.status === "working") {
      agent.status = "idle";
    }
  }

  function handleError(payload: AgentErrorPayload) {
    const agent = agents.get(payload.agent_id);
    if (!agent) return;
    agent.status = "error";
  }

  function handleStatusChange(payload: StatusChangePayload) {
    const agent = agents.get(payload.agent_id);
    if (!agent) return;
    agent.status = payload.status as AgentConnection["status"];
  }

  // ── Event listener setup ──────────────────────────────────────

  async function setupListeners() {
    await listen<MessageChunkPayload>("agent:message-chunk", (e) =>
      handleMessageChunk(e.payload),
    );
    await listen<ToolCallUpdatePayload>("agent:tool-call-update", (e) =>
      handleToolCallUpdate(e.payload),
    );
    await listen<PromptCompletePayload>("agent:prompt-complete", (e) =>
      handlePromptComplete(e.payload),
    );
    await listen<AgentErrorPayload>("agent:error", (e) =>
      handleError(e.payload),
    );
    await listen<StatusChangePayload>("agent:status-change", (e) =>
      handleStatusChange(e.payload),
    );
  }

  // ── Public API ────────────────────────────────────────────────

  async function detectAgents(): Promise<AgentInfo[]> {
    return invoke<AgentInfo[]>("detect_agents");
  }

  async function spawnAgent(
    swarmId: string,
    workingDirectory: string,
    agentCli: string,
  ): Promise<string> {
    const agentId = await invoke<string>("spawn_agent", {
      workingDirectory,
      agentCli,
    });

    agents.set(agentId, {
      id: agentId,
      swarmId,
      cli: agentCli,
      status: "initializing",
      messages: [],
      activeToolCalls: new Map(),
      stopReason: null,
    });

    // Once spawn_agent returns, the agent is initialized and has a session
    const agent = agents.get(agentId)!;
    agent.status = "idle";

    return agentId;
  }

  async function sendPrompt(agentId: string, text: string): Promise<void> {
    const agent = agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    // Add user message to the conversation
    agent.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    });

    agent.status = "working";

    // Fire and forget — responses come via events
    invoke("send_prompt", { agentId, text }).catch((err) => {
      agent.status = "error";
      console.error("send_prompt failed:", err);
    });
  }

  async function cancelPrompt(agentId: string): Promise<void> {
    await invoke("cancel_prompt", { agentId });
  }

  async function killAgent(agentId: string): Promise<void> {
    await invoke("kill_agent", { agentId });
    agents.delete(agentId);
  }

  function toDisplayAgent(conn: AgentConnection): DisplayAgent {
    const lastMsg = conn.messages.at(-1);
    const statusMap: Record<AgentConnection["status"], DisplayAgent["status"]> = {
      initializing: "working",
      idle: "idle",
      working: "working",
      error: "error",
    };
    return {
      id: conn.id,
      swarmId: conn.swarmId,
      name: conn.cli,
      status: statusMap[conn.status],
      preview: lastMsg?.content?.slice(0, 30) + "..." || "",
      updatedAt: "just now",
      messages: conn.messages,
    };
  }

  return {
    get agents() {
      return agents;
    },
    getAgent,
    toDisplayAgent,
    setupListeners,
    detectAgents,
    spawnAgent,
    sendPrompt,
    cancelPrompt,
    killAgent,
  };
}

export const agentStore = createAgentStore();
