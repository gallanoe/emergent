// src/stores/mock-data.svelte.ts

import type { DisplayAgent, DisplaySwarm } from "./types";

const swarms: DisplaySwarm[] = [
  {
    id: "swarm-1",
    name: "website-redesign",
    collapsed: false,
    agents: [
      {
        id: "agent-1",
        swarmId: "swarm-1",
        cli: "claude-agent-acp",
        name: "Refactoring the navigation component",
        status: "working",
        preview: "Refactoring the nav compo...",
        updatedAt: "2m ago",
        messages: [
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
        ],
      },
      {
        id: "agent-2",
        swarmId: "swarm-1",
        cli: "claude-agent-acp",
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
        ],
      },
      {
        id: "agent-3",
        swarmId: "swarm-1",
        cli: "codex-acp",
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
            toolCalls: [
              {
                id: "tc8",
                name: "Read file",
                kind: "read",
                status: "completed",
                locations: ["src/components/Hero.svelte"],
                content: [],
              },
            ],
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
        cli: "claude-agent-acp",
        name: "Migrate auth endpoints to v2",
        status: "working",
        preview: "I want to moderniz...",
        updatedAt: "1m ago",
        messages: [],
      },
      {
        id: "agent-5",
        swarmId: "swarm-2",
        cli: "codex-acp",
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
