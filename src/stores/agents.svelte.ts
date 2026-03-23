import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  ConfigOption,
  DisplayAgent,
  DisplayMessage,
  DisplayToolCall,
  ToolCallContentItem,
  ToolKind,
} from "./types";

// ── Internal state per agent ────────────────────────────────────

interface AgentConnection {
  id: string;
  swarmId: string;
  cli: string;
  status: "initializing" | "idle" | "working" | "error";
  messages: DisplayMessage[];
  activeToolCalls: Record<string, DisplayToolCall>;
  stopReason: string | null;
  queuedContent: string;
  configOptions: ConfigOption[];
}

// ── Event payloads from Rust ────────────────────────────────────

interface MessageChunkPayload {
  agent_id: string;
  content: string;
  kind: "message" | "thinking";
}

interface ToolCallContentPayload {
  type: string;
  text?: string;
  path?: string;
  old_text?: string | null;
  new_text?: string;
  terminal_id?: string;
  output?: string;
  exit_code?: number | null;
}

interface ToolCallUpdatePayload {
  agent_id: string;
  tool_call_id: string;
  title: string;
  kind?: string;
  status: string;
  locations?: string[];
  content?: ToolCallContentPayload[];
}

interface PromptCompletePayload {
  agent_id: string;
  stop_reason: string;
}

interface UserMessagePayload {
  agent_id: string;
  content: string;
}

interface AgentErrorPayload {
  agent_id: string;
  message: string;
}

interface StatusChangePayload {
  agent_id: string;
  status: string;
}

interface ConfigUpdatePayload {
  agent_id: string;
  config_options: ConfigOption[];
  changes: { option_name: string; new_value_name: string }[];
}

interface AgentInfo {
  name: string;
  binary: string;
  path: string;
}

// ── Store ───────────────────────────────────────────────────────

interface ChunkBuffer {
  content: string;
  kind: "message" | "thinking";
}

function roleForKind(kind: "message" | "thinking"): "assistant" | "thinking" {
  return kind === "thinking" ? "thinking" : "assistant";
}

function createAgentStore() {
  // Plain object instead of Map — Svelte 5 reliably deep-proxies plain objects
  let agents: Record<string, AgentConnection> = $state({});

  // Callback for dumping queued content to the input on error
  let onQueueDump: ((agentId: string, content: string) => void) | null = null;

  function registerQueueDumpHandler(handler: (agentId: string, content: string) => void) {
    onQueueDump = handler;
  }

  function getAgent(agentId: string): AgentConnection | undefined {
    return agents[agentId];
  }

  // ── Chunk buffering ─────────────────────────────────────────
  // Accumulate chunks in a plain (non-reactive) buffer and flush
  // once per animation frame to avoid per-chunk re-renders.

  const chunkBuffers: Record<string, ChunkBuffer> = {};
  let flushScheduled = false;

  function flushChunkBuffers() {
    for (const agentId of Object.keys(chunkBuffers)) {
      const buffer = chunkBuffers[agentId];
      const agent = agents[agentId];
      if (!agent || !buffer?.content) continue;

      const role = roleForKind(buffer.kind);
      const lastMsg = agent.messages.at(-1);

      // Append to the last message only if it matches the same role
      if (lastMsg && lastMsg.role === role && !lastMsg.toolCalls?.length) {
        lastMsg.content += buffer.content;
      } else {
        agent.messages.push({
          id: crypto.randomUUID(),
          role,
          content: buffer.content,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
        });
      }
    }

    // Reset buffer state
    for (const key of Object.keys(chunkBuffers)) {
      delete chunkBuffers[key];
    }
    flushScheduled = false;
  }

  // ── Message assembly ──────────────────────────────────────────

  function handleMessageChunk(payload: MessageChunkPayload) {
    const existing = chunkBuffers[payload.agent_id];

    // If the kind changed mid-frame, flush first so thinking and message
    // don't merge into the same buffer.
    if (existing && existing.kind !== payload.kind) {
      flushChunkBuffers();
    }

    const buffer = chunkBuffers[payload.agent_id];
    if (buffer) {
      buffer.content += payload.content;
    } else {
      chunkBuffers[payload.agent_id] = { content: payload.content, kind: payload.kind };
    }

    if (!flushScheduled) {
      flushScheduled = true;
      requestAnimationFrame(flushChunkBuffers);
    }
  }

  function mapToolCallContent(items: ToolCallContentPayload[]): ToolCallContentItem[] {
    return items.map((item): ToolCallContentItem => {
      if (item.type === "diff") {
        return {
          type: "diff",
          path: item.path ?? "",
          oldText: item.old_text ?? null,
          newText: item.new_text ?? "",
        };
      }
      if (item.type === "terminal") {
        const terminal: ToolCallContentItem = {
          type: "terminal",
          terminalId: item.terminal_id ?? "",
        };
        if (item.output != null) terminal.output = item.output;
        if (item.exit_code != null) terminal.exitCode = item.exit_code;
        return terminal;
      }
      return { type: "text", text: item.text ?? "" };
    });
  }

  function handleToolCallUpdate(payload: ToolCallUpdatePayload) {
    const agent = agents[payload.agent_id];
    if (!agent) return;

    const existing = agent.activeToolCalls[payload.tool_call_id];
    const tc: DisplayToolCall = {
      id: payload.tool_call_id,
      name: payload.title ?? existing?.name ?? "Tool call",
      kind: (payload.kind ?? existing?.kind ?? "other") as ToolKind,
      status: (payload.status ?? existing?.status ?? "pending") as DisplayToolCall["status"],
      locations: payload.locations ?? existing?.locations ?? [],
      content: payload.content ? mapToolCallContent(payload.content) : (existing?.content ?? []),
    };

    agent.activeToolCalls[payload.tool_call_id] = tc;

    if (payload.status === "completed" || payload.status === "failed") {
      const allDone = Object.values(agent.activeToolCalls).every(
        (t) => t.status === "completed" || t.status === "failed",
      );
      const count = Object.keys(agent.activeToolCalls).length;

      if (allDone && count > 0) {
        const toolCalls = Object.values(agent.activeToolCalls);
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
        // Clear by replacing with empty object
        agent.activeToolCalls = {};
      }
    }
  }

  function handlePromptComplete(payload: PromptCompletePayload) {
    // Flush any buffered chunks before finalizing
    if (chunkBuffers[payload.agent_id]) {
      flushChunkBuffers();
    }

    const agent = agents[payload.agent_id];
    if (!agent) return;

    agent.stopReason = payload.stop_reason;

    // Flush queue: if content is queued, submit it as the next prompt.
    // Set status to "idle" first so sendPrompt takes the normal send path
    // (it checks status !== "working"). This is synchronous — no visible
    // flicker since Svelte batches reactive updates within the same microtask.
    if (agent.queuedContent) {
      const queued = agent.queuedContent;
      agent.queuedContent = "";
      agent.status = "idle";
      sendPrompt(agent.id, queued);
      return;
    }

    if (agent.status === "working") {
      agent.status = "idle";
    }
  }

  function handleError(payload: AgentErrorPayload) {
    const agent = agents[payload.agent_id];
    if (!agent) return;

    if (agent.queuedContent && onQueueDump) {
      const queued = agent.queuedContent;
      agent.queuedContent = "";
      onQueueDump(payload.agent_id, queued);
    }

    agent.status = "error";
  }

  function handleUserMessage(payload: UserMessagePayload) {
    const agent = agents[payload.agent_id];
    if (!agent) return;

    agent.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: payload.content,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    });
  }

  function handleStatusChange(payload: StatusChangePayload) {
    const agent = agents[payload.agent_id];
    if (!agent) return;
    agent.status = payload.status as AgentConnection["status"];
  }

  function handleConfigUpdate(payload: ConfigUpdatePayload) {
    const agent = agents[payload.agent_id];
    if (!agent) return;

    agent.configOptions = payload.config_options;

    // Insert system message for agent-initiated changes (non-empty changes)
    if (payload.changes.length > 0) {
      const text = payload.changes
        .map((c) => `${c.option_name} changed to ${c.new_value_name}`)
        .join(", ");
      agent.messages.push({
        id: crypto.randomUUID(),
        role: "system",
        content: text,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
      });
    }
  }

  // ── Event listener setup ──────────────────────────────────────

  async function setupListeners() {
    await listen<MessageChunkPayload>("agent:message-chunk", (e) => handleMessageChunk(e.payload));
    await listen<ToolCallUpdatePayload>("agent:tool-call-update", (e) =>
      handleToolCallUpdate(e.payload),
    );
    await listen<PromptCompletePayload>("agent:prompt-complete", (e) =>
      handlePromptComplete(e.payload),
    );
    await listen<AgentErrorPayload>("agent:error", (e) => handleError(e.payload));
    await listen<StatusChangePayload>("agent:status-change", (e) => handleStatusChange(e.payload));
    await listen<ConfigUpdatePayload>("agent:config-update", (e) => handleConfigUpdate(e.payload));
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

    agents[agentId] = {
      id: agentId,
      swarmId,
      cli: agentCli,
      status: "idle",
      messages: [],
      activeToolCalls: {},
      stopReason: null,
      queuedContent: "",
      configOptions: [],
    };

    // Fetch config after agent is registered — the initial ConfigUpdate
    // notification races with spawn_agent returning, so we fetch explicitly.
    invoke<ConfigOption[]>("get_agent_config", { agentId })
      .then((config) => {
        const agent = agents[agentId];
        if (agent && config.length > 0) {
          agent.configOptions = config;
        }
      })
      .catch(() => {});

    return agentId;
  }

  async function sendPrompt(agentId: string, text: string): Promise<void> {
    const agent = agents[agentId];
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    // Queue path: agent is busy, accumulate content
    if (agent.status === "working") {
      agent.queuedContent = agent.queuedContent ? agent.queuedContent + "\n\n" + text : text;
      return;
    }

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

    invoke("send_prompt", { agentId, text }).catch((err) => {
      agent.status = "error";
      console.error("send_prompt failed:", err);
    });
  }

  async function cancelPrompt(agentId: string): Promise<void> {
    await invoke("cancel_prompt", { agentId });
  }

  function editQueue(agentId: string): string {
    const agent = agents[agentId];
    if (!agent) return "";
    const content = agent.queuedContent;
    agent.queuedContent = "";
    return content;
  }

  async function setConfig(agentId: string, configId: string, value: string): Promise<void> {
    const agent = agents[agentId];
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    // Optimistic update — use $state.snapshot to clone the reactive proxy
    const previousConfig = $state.snapshot(agent.configOptions);
    const opt = agent.configOptions.find((o) => o.id === configId);
    if (opt) opt.current_value = value;

    try {
      await invoke<ConfigOption[]>("set_agent_config", {
        agentId,
        configId,
        value,
      });
    } catch (err) {
      // Revert on error
      agent.configOptions = previousConfig;
      console.error("set_agent_config failed:", err);
    }
  }

  async function killAgent(agentId: string): Promise<void> {
    await invoke("kill_agent", { agentId });
    delete agents[agentId];
  }

  const CLI_DISPLAY_NAMES: Record<string, string> = {
    "claude-agent-acp": "Claude Code",
    "codex-acp": "Codex",
    "gemini --experimental-acp": "Gemini",
  };

  function getAgentDisplayName(conn: AgentConnection): string {
    const typeName = CLI_DISPLAY_NAMES[conn.cli] ?? conn.cli;

    // Count how many agents of the same type exist in the same swarm
    const siblings = Object.values(agents).filter(
      (a) => a.swarmId === conn.swarmId && a.cli === conn.cli,
    );

    if (siblings.length <= 1) return typeName;

    // Assign a stable sequential number based on insertion order
    const index = siblings.findIndex((a) => a.id === conn.id);
    return `${typeName} #${index + 1}`;
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
      cli: conn.cli,
      name: getAgentDisplayName(conn),
      status: statusMap[conn.status],
      preview: lastMsg?.content ? lastMsg.content.slice(0, 30) + "..." : "",
      updatedAt: "just now",
      messages: conn.messages,
      activeToolCalls: Object.values(conn.activeToolCalls),
      queuedMessage: conn.queuedContent || null,
      configOptions: conn.configOptions,
    };
  }

  function registerExistingAgent(agentId: string, swarmId: string, cli: string) {
    agents[agentId] = {
      id: agentId,
      swarmId,
      cli,
      status: "idle",
      messages: [],
      activeToolCalls: {},
      stopReason: null,
      queuedContent: "",
      configOptions: [],
    };
  }

  type DaemonNotification =
    | ({ type: "agent:message-chunk" } & MessageChunkPayload)
    | ({ type: "agent:tool-call-update" } & ToolCallUpdatePayload)
    | ({ type: "agent:prompt-complete" } & PromptCompletePayload)
    | ({ type: "agent:status-change" } & StatusChangePayload)
    | ({ type: "agent:config-update" } & ConfigUpdatePayload)
    | ({ type: "agent:user-message" } & UserMessagePayload)
    | ({ type: "agent:error" } & AgentErrorPayload);

  function replayNotifications(notifications: DaemonNotification[]) {
    for (const n of notifications) {
      switch (n.type) {
        case "agent:message-chunk":
          handleMessageChunk(n);
          break;
        case "agent:tool-call-update":
          handleToolCallUpdate(n);
          break;
        case "agent:prompt-complete":
          handlePromptComplete(n);
          break;
        case "agent:status-change":
          handleStatusChange(n);
          break;
        case "agent:config-update":
          handleConfigUpdate(n);
          break;
        case "agent:user-message":
          handleUserMessage(n);
          break;
        case "agent:error":
          handleError(n);
          break;
      }
    }
    // Force flush any buffered chunks after replay
    flushChunkBuffers();
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
    setConfig,
    editQueue,
    registerQueueDumpHandler,
    registerExistingAgent,
    replayNotifications,
  };
}

export const agentStore = createAgentStore();
