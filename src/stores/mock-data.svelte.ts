// src/stores/mock-data.svelte.ts

import type {
  DisplayAgentDefinition,
  DisplayMessage,
  DisplayTask,
  DisplayThread,
  DisplayWorkspace,
} from "./types";
import { mockMetrics } from "./mock-metrics.svelte";

const T1_MESSAGES: DisplayMessage[] = [
  {
    id: "m0",
    role: "user",
    content: "Refactor the navigation component into smaller, reusable pieces.",
    timestamp: "1:09 PM",
  },
  {
    id: "m1",
    role: "assistant",
    content:
      "I'll start by analyzing the current navigation structure and identifying the components that need refactoring.",
    timestamp: "1:10 PM",
  },
  {
    id: "m2",
    role: "tool-group",
    content: "",
    toolCalls: [
      {
        id: "tc1",
        name: "Read file",
        kind: "read",
        status: "completed",
        locations: ["src/components/Nav.svelte"],
        content: [],
      },
      {
        id: "tc2",
        name: "Read file",
        kind: "read",
        status: "completed",
        locations: ["src/lib/routes.ts"],
        content: [],
      },
    ],
    timestamp: "1:10 PM",
  },
  {
    id: "m3",
    role: "assistant",
    content:
      "The navigation is currently a single 200-line component. I'll break it into three smaller components: NavLogo, NavLinks, and NavMenu.",
    timestamp: "1:10 PM",
  },
  {
    id: "m4",
    role: "tool-group",
    content: "",
    toolCalls: [
      {
        id: "tc3",
        name: "Write file",
        kind: "edit",
        status: "completed",
        locations: ["src/components/NavLogo.svelte"],
        content: [
          {
            type: "text",
            text: '<script lang="ts">\n  let { href = "/" }: { href?: string } = $props();\n</script>\n<a {href} class="nav-logo">...',
          },
        ],
      },
      {
        id: "tc4",
        name: "Write file",
        kind: "edit",
        status: "completed",
        locations: ["src/components/NavLinks.svelte"],
        content: [
          {
            type: "text",
            text: '<script lang="ts">\n  import { routes } from "../lib/routes";\n</script>\n<nav class="nav-links">...',
          },
        ],
      },
      {
        id: "tc5",
        name: "Write file",
        kind: "edit",
        status: "completed",
        locations: ["src/components/NavMenu.svelte"],
        content: [
          {
            type: "text",
            text: '<script lang="ts">\n  let open = $state(false);\n</script>\n<button onclick={() => open = !open}>...',
          },
        ],
      },
    ],
    timestamp: "1:11 PM",
  },
];

const T4_MESSAGES: DisplayMessage[] = [
  {
    id: "m5",
    role: "assistant",
    content: "I'll set up the Tailwind configuration with your design tokens.",
    timestamp: "1:02 PM",
  },
  {
    id: "m6",
    role: "tool-group",
    content: "",
    toolCalls: [
      {
        id: "tc6",
        name: "Read file",
        kind: "read",
        status: "completed",
        locations: ["tailwind.config.ts"],
        content: [],
      },
      {
        id: "tc7",
        name: "Write file",
        kind: "edit",
        status: "completed",
        locations: ["tailwind.config.ts"],
        content: [
          {
            type: "diff",
            path: "tailwind.config.ts",
            oldText: 'colors: {\n  primary: "#000"',
            newText: 'colors: {\n  primary: "#7c6a4e",\n  accent: "#6b5b42"',
          },
        ],
      },
    ],
    timestamp: "1:02 PM",
  },
  {
    id: "m7",
    role: "assistant",
    content: "Tailwind is configured with your custom color palette and font families.",
    timestamp: "1:03 PM",
  },
];

let demoMsgSeq = 0;
function mkMsg(role: DisplayMessage["role"], content: string, ts: string): DisplayMessage {
  demoMsgSeq += 1;
  return { id: `demo-msg-${demoMsgSeq}`, role, content, timestamp: ts };
}

function mkThread(
  id: string,
  agentDefinitionId: string,
  name: string,
  processStatus: DisplayThread["processStatus"],
  cli: string,
  messages: DisplayMessage[],
  extra?: Partial<DisplayThread>,
): DisplayThread {
  const providerByAgent: Record<string, string> = {
    a1: "claude",
    a2: "codex",
    a3: "gemini",
    a4: "opencode",
    a5: "kiro",
  };
  return {
    id,
    agentId: agentDefinitionId,
    workspaceId: "ws1",
    cli,
    provider: providerByAgent[agentDefinitionId] ?? null,
    name,
    processStatus,
    preview: "",
    updatedAt: "just now",
    messages,
    activeToolCalls: [],
    queuedMessage: null,
    configOptions: [],
    stopReason: null,
    taskId: null,
    ...extra,
  };
}

const DEMO_TASKS: DisplayTask[] = [
  {
    id: "TSK-041",
    status: "working",
    title: "Drop CHROMA_WEIGHT to 1.2 and re-run corpus",
    description: "",
    parent_id: null,
    blocker_ids: [],
    agent_id: "a1",
    session_id: "t3",
    workspace_id: "ws1",
    created_at: "2026-04-22T08:00:00Z",
  },
  {
    id: "TSK-039",
    status: "working",
    title: "Verify palette delta across 12-image corpus",
    description: "",
    parent_id: "TSK-041",
    blocker_ids: ["TSK-041"],
    agent_id: "a2",
    session_id: "t5",
    workspace_id: "ws1",
    created_at: "2026-04-22T07:30:00Z",
  },
  {
    id: "TSK-040",
    status: "pending",
    title: "Document the quantization tradeoff in README",
    description: "",
    parent_id: "TSK-041",
    blocker_ids: ["TSK-039"],
    agent_id: "a1",
    session_id: null,
    workspace_id: "ws1",
    created_at: "2026-04-22T07:10:00Z",
  },
  {
    id: "TSK-038",
    status: "pending",
    title: "Add regression corpus for extreme chroma",
    description: "",
    parent_id: null,
    blocker_ids: [],
    agent_id: "a3",
    session_id: null,
    workspace_id: "ws1",
    created_at: "2026-04-22T06:55:00Z",
  },
  {
    id: "TSK-037",
    status: "completed",
    title: "Profile quantize.rs hot path",
    description: "",
    parent_id: null,
    blocker_ids: [],
    agent_id: "a1",
    session_id: null,
    workspace_id: "ws1",
    created_at: "2026-04-21T16:20:00Z",
  },
  {
    id: "TSK-033",
    status: "failed",
    title: "Rework k-means init (seed instability)",
    description: "",
    parent_id: null,
    blocker_ids: [],
    agent_id: "a4",
    session_id: "t7",
    workspace_id: "ws1",
    created_at: "2026-04-20T10:00:00Z",
  },
];

const agentDefinitions: DisplayAgentDefinition[] = [
  {
    id: "a1",
    name: "claude-sonnet",
    role: "architect",
    cli: "claude",
    provider: "claude",
    systemPrompt: "",
    threads: [
      mkThread("t1", "a1", "refine quantization", "working", "claude", T1_MESSAGES, {
        updatedAt: "now",
        preview: "Refining quant…",
      }),
      mkThread(
        "t2",
        "a1",
        "color scheme API",
        "idle",
        "claude",
        [mkMsg("assistant", "Idle.", "3m")],
        {
          updatedAt: "3m",
        },
      ),
      mkThread(
        "t3",
        "a1",
        "session TSK-041",
        "idle",
        "claude",
        [mkMsg("assistant", "Session idle.", "12m")],
        { updatedAt: "12m", taskId: "TSK-041" },
      ),
    ],
  },
  {
    id: "a2",
    name: "codex-validator",
    role: "reviewer",
    cli: "codex",
    provider: "codex",
    systemPrompt: "",
    threads: [
      mkThread("t4", "a2", "verify palette delta", "idle", "codex", T4_MESSAGES, {
        updatedAt: "30s",
      }),
      mkThread(
        "t5",
        "a2",
        "session TSK-039",
        "idle",
        "codex",
        [mkMsg("assistant", "Review queued.", "1h")],
        { updatedAt: "1h", taskId: "TSK-039" },
      ),
    ],
  },
  {
    id: "a3",
    name: "gemini-explorer",
    cli: "gemini",
    provider: "gemini",
    systemPrompt: "",
    threads: [
      mkThread(
        "t6",
        "a3",
        "reading deps",
        "initializing",
        "gemini",
        [mkMsg("assistant", "Starting up…", "just now")],
        { updatedAt: "just now" },
      ),
    ],
  },
  {
    id: "a4",
    name: "opencode-sweeper",
    role: "cleanup",
    cli: "opencode",
    provider: "opencode",
    systemPrompt: "",
    threads: [
      mkThread(
        "t7",
        "a4",
        "session TSK-033",
        "dead",
        "opencode",
        [mkMsg("assistant", "Thread ended.", "yesterday")],
        { updatedAt: "yesterday", taskId: "TSK-033" },
      ),
    ],
  },
  {
    id: "a5",
    name: "kiro-scout",
    cli: "kiro",
    provider: "kiro",
    systemPrompt: "",
    threads: [],
  },
];

const swarms: DisplayWorkspace[] = [
  {
    id: "ws1",
    name: "emergent-core",
    collapsed: false,
    containerStatus: { state: "running" },
    agentDefinitions,
  },
  {
    id: "ws2",
    name: "api-migration",
    collapsed: true,
    containerStatus: { state: "stopped" },
    agentDefinitions: [],
  },
];

function findThread(threadId: string): DisplayThread | undefined {
  for (const s of swarms) {
    for (const d of s.agentDefinitions) {
      const t = d.threads.find((th) => th.id === threadId);
      if (t) return t;
    }
  }
  return undefined;
}

function firstThreadForAgent(agentDefId: string): DisplayThread | undefined {
  const def = agentDefinitions.find((d) => d.id === agentDefId);
  return def?.threads[0];
}

function agentIdForThread(threadId: string): string | null {
  for (const d of agentDefinitions) {
    if (d.threads.some((th) => th.id === threadId)) return d.id;
  }
  return null;
}

function seedDemoMockMetrics() {
  mockMetrics.seedAgent("a1", { input: 412, output: 84, cost: 2.61 });
  mockMetrics.seedAgent("a2", { input: 186, output: 41, cost: 1.18 });
  mockMetrics.seedAgent("a3", { input: 94, output: 12, cost: 0.38 });
  mockMetrics.seedAgent("a4", { input: 28, output: 5, cost: 0.09 });
  mockMetrics.seedAgent("a5", { input: 0, output: 0, cost: 0 });
  mockMetrics.seedWorkspace("ws1", {
    cpuPct: 14,
    memMb: 312,
    memLimitMb: 2048,
    netKbps: 1200,
    cpuSeries: [2, 3, 2, 4, 6, 5, 4, 7, 5, 6, 8, 5],
    memSeries: [3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 6, 6],
    netSeries: [1, 0, 2, 4, 1, 3, 0, 2, 5, 3, 1, 2],
  });
}

function createAppState() {
  let _swarms = $state(swarms);
  let _selectedAgentId = $state("a1");

  return {
    get swarms() {
      return _swarms;
    },
    get selectedAgentId() {
      return _selectedAgentId;
    },
    set selectedAgentId(id: string) {
      _selectedAgentId = id;
    },

    resolveSelectedThread(explicitThreadId: string | null): DisplayThread | undefined {
      if (explicitThreadId) return findThread(explicitThreadId);
      return firstThreadForAgent(_selectedAgentId);
    },

    findThread,
    agentIdForThread,

    getWorkspaceTasks(workspaceId: string | null): DisplayTask[] {
      const wid = workspaceId ?? "ws1";
      return DEMO_TASKS.filter((t) => t.workspace_id === wid);
    },

    seedDemoMockMetrics,

    toggleSwarmCollapsed(swarmId: string) {
      const swarm = _swarms.find((s) => s.id === swarmId);
      if (swarm) swarm.collapsed = !swarm.collapsed;
    },
  };
}

export const appState = createAppState();
