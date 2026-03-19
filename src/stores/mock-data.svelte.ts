// src/stores/mock-data.svelte.ts

import type { AgentStatus, DisplayAgent, DisplayMessage, DisplaySwarm, DisplayToolCall } from "./types";

// Re-export types for backward compatibility
export type { DisplayAgent as Agent, DisplayMessage as Message, DisplayToolCall as ToolCall, DisplaySwarm as Swarm, AgentStatus };

const swarms: DisplaySwarm[] = [
  {
    id: "swarm-1",
    name: "website-redesign",
    collapsed: false,
    agents: [
      {
        id: "agent-1",
        swarmId: "swarm-1",
        name: "Refactoring the navigation component",
        status: "working",
        preview: "Refactoring the nav compo...",
        updatedAt: "2m ago",
        messages: [
          {
            id: "m0",
            role: "user",
            content:
              "Refactor the navigation component into smaller, reusable pieces.",
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
              { id: "tc1", name: "Read file", status: "completed", content: "src/components/Nav.svelte" },
              { id: "tc2", name: "Read file", status: "completed", content: "src/lib/routes.ts" },
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
              { id: "tc3", name: "Write file", status: "completed", content: "src/components/NavLogo.svelte" },
              { id: "tc4", name: "Write file", status: "completed", content: "src/components/NavLinks.svelte" },
              { id: "tc5", name: "Write file", status: "completed", content: "src/components/NavMenu.svelte" },
            ],
            timestamp: "1:11 PM",
          },
        ],
      },
      {
        id: "agent-2",
        swarmId: "swarm-1",
        name: "Set up Tailwind config",
        status: "idle",
        preview: "Set up Tailwind config wi...",
        updatedAt: "8m ago",
        messages: [
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
              { id: "tc6", name: "Read file", status: "completed", content: "tailwind.config.ts" },
              { id: "tc7", name: "Write file", status: "completed", content: "tailwind.config.ts" },
            ],
            timestamp: "1:02 PM",
          },
          {
            id: "m7",
            role: "assistant",
            content: "Tailwind is configured with your custom color palette and font families.",
            timestamp: "1:03 PM",
          },
        ],
      },
      {
        id: "agent-3",
        swarmId: "swarm-1",
        name: "Fix broken image imports",
        status: "error",
        preview: "Build failed: missing dep...",
        updatedAt: "5m ago",
        messages: [
          {
            id: "m8",
            role: "assistant",
            content: "Looking into the broken image imports across the components.",
            timestamp: "1:05 PM",
          },
          {
            id: "m9",
            role: "tool-group",
            content: "",
            toolCalls: [{ id: "tc8", name: "Read file", status: "completed", content: "src/components/Hero.svelte" }],
            timestamp: "1:05 PM",
          },
          {
            id: "m10",
            role: "assistant",
            content:
              "Error: Cannot resolve dependency 'assets/hero.webp' — the file doesn't exist in the assets directory.",
            timestamp: "1:06 PM",
          },
        ],
      },
    ],
  },
  {
    id: "swarm-2",
    name: "api-migration",
    collapsed: true,
    agents: [
      {
        id: "agent-4",
        swarmId: "swarm-2",
        name: "Migrate auth endpoints to v2",
        status: "working",
        preview: "I want to moderniz...",
        updatedAt: "1m ago",
        messages: [],
      },
      {
        id: "agent-5",
        swarmId: "swarm-2",
        name: "Update API documentation",
        status: "idle",
        preview: "How hard would ...",
        updatedAt: "15m ago",
        messages: [],
      },
    ],
  },
];

function createAppState() {
  let _swarms = $state(swarms);
  let _selectedAgentId = $state("agent-1");

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

    get selectedAgent(): DisplayAgent | undefined {
      for (const swarm of _swarms) {
        const agent = swarm.agents.find((a) => a.id === _selectedAgentId);
        if (agent) return agent;
      }
      return undefined;
    },

    toggleSwarmCollapsed(swarmId: string) {
      const swarm = _swarms.find((s) => s.id === swarmId);
      if (swarm) swarm.collapsed = !swarm.collapsed;
    },
  };
}

export const appState = createAppState();
