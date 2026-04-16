import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ChatArea from "./ChatArea.svelte";
import type { DisplayThread, DisplayMessage } from "../../stores/types";

function makeAgent(messages: DisplayMessage[], overrides?: Partial<DisplayThread>): DisplayThread {
  return {
    id: "agent-1",
    agentId: "def-1",
    workspaceId: "swarm-1",
    cli: "claude-agent-acp",
    name: "Test Agent",
    status: "idle",
    processStatus: "idle",
    preview: "test...",
    updatedAt: "1m ago",
    messages,
    activeToolCalls: [],
    queuedMessage: null,
    configOptions: [],
    hasManagementPermissions: false,
    stopReason: null,
    taskId: null,
    ...overrides,
  };
}

function msg(
  role: DisplayMessage["role"],
  content: string,
  timestamp: string,
  extra?: Partial<DisplayMessage>,
): DisplayMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp,
    ...extra,
  };
}

describe("ChatArea", () => {
  it("shows placeholder when no agent is selected", () => {
    render(ChatArea, { props: { agent: undefined } });
    expect(screen.getByText("Select an agent to view its conversation")).toBeTruthy();
  });

  it("renders assistant messages", () => {
    const agent = makeAgent([msg("assistant", "Hello world", "1:00 PM")]);
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("Hello world")).toBeTruthy();
  });

  it("renders user messages", () => {
    const agent = makeAgent([msg("user", "Fix the bug", "1:00 PM")]);
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("Fix the bug")).toBeTruthy();
  });

  it("renders tool call groups with verb and target", () => {
    const agent = makeAgent([
      msg("assistant", "Let me check", "1:00 PM"),
      msg("tool-group", "", "1:00 PM", {
        toolCalls: [
          {
            id: "tc1",
            name: "Read file",
            kind: "read",
            status: "completed",
            locations: ["src/foo.ts"],
            content: [],
          },
        ],
      }),
    ]);
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("Read")).toBeTruthy();
    expect(screen.getByText("src/foo.ts")).toBeTruthy();
  });

  it("renders multiple tool calls open by default", () => {
    const agent = makeAgent([
      msg("assistant", "Checking...", "1:00 PM"),
      msg("tool-group", "", "1:00 PM", {
        toolCalls: [
          {
            id: "tc1",
            name: "Read file",
            kind: "read",
            status: "completed",
            locations: ["src/foo.ts"],
            content: [],
          },
          {
            id: "tc2",
            name: "Write file",
            kind: "edit",
            status: "completed",
            locations: ["src/bar.ts"],
            content: [],
          },
        ],
      }),
    ]);
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("src/foo.ts")).toBeTruthy();
    expect(screen.getByText("src/bar.ts")).toBeTruthy();
  });

  it("renders custom MCP card for list_agents", () => {
    const agent = makeAgent([
      msg("tool-group", "", "1:00 PM", {
        toolCalls: [
          {
            id: "tc-agents",
            name: "list_agents",
            kind: "other",
            status: "completed",
            locations: [],
            content: [
              {
                type: "text",
                text: JSON.stringify([
                  { id: "a1b2c3d4", name: "Planner" },
                  { id: "e5f6g7h8", name: "Reviewer" },
                ]),
              },
            ],
          },
        ],
      }),
    ]);
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("Agents")).toBeTruthy();
    expect(screen.getByText("2 agents")).toBeTruthy();
    expect(screen.getByText("Planner")).toBeTruthy();
    expect(screen.getByText("Reviewer")).toBeTruthy();
  });

  it("renders custom MCP card for list_tasks", () => {
    const agent = makeAgent([
      msg("tool-group", "", "1:00 PM", {
        toolCalls: [
          {
            id: "tc-tasks",
            name: "list_tasks",
            kind: "other",
            status: "completed",
            locations: [],
            content: [
              {
                type: "text",
                text: JSON.stringify([
                  {
                    id: "task-1",
                    title: "Write migration",
                    description: "Draft it",
                    status: "working",
                    blocker_ids: [],
                    agent_id: "planner-1",
                    session_id: "thread-1",
                    workspace_id: "ws-1",
                    created_at: "2026-04-14T18:00:00Z",
                    parent_id: null,
                  },
                ]),
              },
            ],
          },
        ],
      }),
    ]);
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("Tasks")).toBeTruthy();
    expect(screen.getByText("1 task")).toBeTruthy();
    expect(screen.getByText("Write migration")).toBeTruthy();
    expect(screen.getByText("Working")).toBeTruthy();
  });

  it("renders custom MCP card for create_task", () => {
    const agent = makeAgent([
      msg("tool-group", "", "1:00 PM", {
        toolCalls: [
          {
            id: "tc-create",
            name: "create_task",
            kind: "other",
            status: "completed",
            locations: [],
            rawInput: {
              title: "Write migration",
              description: "Draft the database migration plan.",
              agent_id: "planner-1",
              blocker_ids: ["task-1", "task-2"],
            },
            rawOutput: { task_id: "task-42" },
            content: [{ type: "text", text: JSON.stringify({ task_id: "task-42" }) }],
          },
        ],
      }),
    ]);
    render(ChatArea, { props: { agent } });
    expect(screen.getAllByText("Create Task")).toHaveLength(2);
    expect(screen.getAllByText("Write migration")).toHaveLength(2);
    expect(screen.getByText("Draft the database migration plan.")).toBeTruthy();
    expect(screen.getByText("planner-1")).toBeTruthy();
    expect(screen.getByText("2 blockers")).toBeTruthy();
    expect(screen.getByText("Created task-42")).toBeTruthy();
  });

  it("renders custom MCP card for complete_task", () => {
    const agent = makeAgent([
      msg("tool-group", "", "1:00 PM", {
        toolCalls: [
          {
            id: "tc-complete",
            name: "complete_task",
            kind: "other",
            status: "completed",
            locations: [],
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  task_id: "task-42",
                  status: "completed",
                }),
              },
            ],
          },
        ],
      }),
    ]);
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("Task Completed")).toBeTruthy();
    expect(screen.queryByText("Complete Task")).toBeNull();
  });

  it("renders thinking block collapsed by default", () => {
    const agent = makeAgent([msg("thinking", "Let me analyze this...", "1:00 PM")]);
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.queryByText("Let me analyze this...")).toBeNull();
  });

  it("expands thinking block on click", async () => {
    const agent = makeAgent([msg("thinking", "Let me analyze this...", "1:00 PM")]);
    render(ChatArea, { props: { agent } });
    await fireEvent.click(screen.getByText("Thinking"));
    expect(screen.getByText("Let me analyze this...")).toBeTruthy();
  });

  it("shows working indicator when agent is working", () => {
    const agent = makeAgent([msg("assistant", "Working...", "1:00 PM")], {
      status: "working",
    });
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("· · ·")).toBeTruthy();
  });

  it("renders queued message bubble when queuedMessage exists", () => {
    const agent = makeAgent([msg("user", "Do task A", "1:00 PM")], {
      status: "working",
      queuedMessage: "Do task B",
    });
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("Do task B")).toBeTruthy();
    expect(screen.getByText("Queued")).toBeTruthy();
  });

  it("does not render queued bubble when queuedMessage is null", () => {
    const agent = makeAgent([msg("user", "Do task A", "1:00 PM")], {
      status: "working",
      activeToolCalls: [],
      queuedMessage: null,
    });
    render(ChatArea, { props: { agent } });
    expect(screen.queryByText("Queued")).toBeNull();
  });

  it("renders multiline queued message with whitespace preserved", () => {
    const agent = makeAgent([], {
      status: "working",
      queuedMessage: "Do task B\nDo task C",
    });
    render(ChatArea, { props: { agent } });
    expect(screen.getByText(/Do task B/)).toBeTruthy();
    expect(screen.getByText(/Do task C/)).toBeTruthy();
  });

  it("calls onEditQueue when edit button is clicked", async () => {
    let editCalled = false;
    const agent = makeAgent([], {
      status: "working",
      queuedMessage: "Do task B",
    });
    render(ChatArea, {
      props: {
        agent,
        onEditQueue: () => {
          editCalled = true;
        },
      },
    });
    await fireEvent.click(screen.getByText("Edit"));
    expect(editCalled).toBe(true);
  });

  it("shows connecting banner when agent is initializing", () => {
    const agent = makeAgent([], { status: "initializing" });
    render(ChatArea, { props: { agent } });
    expect(screen.getByText(/Connecting to/)).toBeTruthy();
    expect(screen.getByText("Waiting for the agent to start up")).toBeTruthy();
  });

  it("shows ready banner when agent is idle with no messages", () => {
    const agent = makeAgent([], { status: "idle" });
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("Test Agent")).toBeTruthy();
  });

  it("does not show ready banner when agent has messages", () => {
    const agent = makeAgent([msg("assistant", "Hello", "1:00 PM")], {
      status: "idle",
    });
    render(ChatArea, { props: { agent } });
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("shows error banner with error message when agent has init error", () => {
    const agent = makeAgent([], {
      status: "error",
      errorMessage: "Connection refused: binary not found",
    });
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("Failed to connect")).toBeTruthy();
    expect(screen.getByText("Could not start the agent")).toBeTruthy();
    expect(screen.getByText("Connection refused: binary not found")).toBeTruthy();
  });

  it("hides working indicator when agent is idle", () => {
    const agent = makeAgent([msg("assistant", "Done", "1:00 PM")], {
      status: "idle",
    });
    render(ChatArea, { props: { agent } });
    expect(screen.queryByText("· · ·")).toBeNull();
  });

  it("renders system message as divider", () => {
    const agent = makeAgent(
      [msg("system", "Management permissions have been granted.", "1:00 PM")],
      { status: "idle" },
    );
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("Management permissions have been granted.")).toBeTruthy();
  });
});
