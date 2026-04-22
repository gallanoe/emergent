import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ChatArea from "./ChatArea.svelte";
import type { DisplayThread, DisplayMessage } from "../../stores/types";

function makeThread(messages: DisplayMessage[], overrides?: Partial<DisplayThread>): DisplayThread {
  return {
    id: "agent-1",
    agentId: "def-1",
    workspaceId: "swarm-1",
    cli: "claude-agent-acp",
    name: "Test Agent",
    processStatus: "idle",
    preview: "test...",
    updatedAt: "1m ago",
    messages,
    activeToolCalls: [],
    queuedMessage: null,
    configOptions: [],
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
  it("shows placeholder when no thread is selected", () => {
    render(ChatArea, { props: { thread: undefined } });
    expect(screen.getByText("Select a thread to view its conversation")).toBeTruthy();
  });

  it("renders assistant messages", () => {
    const thread = makeThread([msg("assistant", "Hello world", "1:00 PM")]);
    render(ChatArea, { props: { thread } });
    expect(screen.getByText("Hello world")).toBeTruthy();
  });

  it("renders user messages", () => {
    const thread = makeThread([msg("user", "Fix the bug", "1:00 PM")]);
    render(ChatArea, { props: { thread } });
    expect(screen.getByText("Fix the bug")).toBeTruthy();
  });

  it("renders generic tool calls as flat ToolRow lines", () => {
    const thread = makeThread([
      msg("assistant", "Let me check", "1:00 PM"),
      msg("tool-group", "", "1:00 PM", {
        toolCalls: [
          {
            id: "tc1",
            name: "read_file",
            kind: "read",
            status: "completed",
            locations: ["src/foo.ts"],
            content: [],
          },
        ],
      }),
    ]);
    render(ChatArea, { props: { thread } });
    expect(screen.getByText("read_file")).toBeTruthy();
    expect(screen.getByText("(src/foo.ts)")).toBeTruthy();
  });

  it("renders multiple generic tool calls as separate ToolRows", () => {
    const thread = makeThread([
      msg("assistant", "Checking...", "1:00 PM"),
      msg("tool-group", "", "1:00 PM", {
        toolCalls: [
          {
            id: "tc1",
            name: "read_file",
            kind: "read",
            status: "completed",
            locations: ["src/foo.ts"],
            content: [],
          },
          {
            id: "tc2",
            name: "write_file",
            kind: "edit",
            status: "completed",
            locations: ["src/bar.ts"],
            content: [],
          },
        ],
      }),
    ]);
    render(ChatArea, { props: { thread } });
    expect(screen.getByText("(src/foo.ts)")).toBeTruthy();
    expect(screen.getByText("(src/bar.ts)")).toBeTruthy();
  });

  it("renders custom MCP card for list_agents", () => {
    const thread = makeThread([
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
    render(ChatArea, { props: { thread } });
    expect(screen.getByText("Agents")).toBeTruthy();
    expect(screen.getByText("2 agents")).toBeTruthy();
    expect(screen.getByText("Planner")).toBeTruthy();
    expect(screen.getByText("Reviewer")).toBeTruthy();
  });

  it("renders custom MCP card for list_tasks", () => {
    const thread = makeThread([
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
    render(ChatArea, { props: { thread } });
    expect(screen.getByText("Tasks")).toBeTruthy();
    expect(screen.getByText("1 task")).toBeTruthy();
    expect(screen.getByText("Write migration")).toBeTruthy();
    expect(screen.getByText("Working")).toBeTruthy();
  });

  it("renders custom MCP card for create_task", () => {
    const thread = makeThread([
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
    render(ChatArea, { props: { thread } });
    expect(screen.getAllByText("Create Task")).toHaveLength(2);
    expect(screen.getAllByText("Write migration")).toHaveLength(2);
    expect(screen.getByText("Draft the database migration plan.")).toBeTruthy();
    expect(screen.getByText("planner-1")).toBeTruthy();
    expect(screen.getByText("2 blockers")).toBeTruthy();
    expect(screen.getByText("Created task-42")).toBeTruthy();
  });

  it("renders custom MCP card for complete_task", () => {
    const thread = makeThread([
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
    render(ChatArea, { props: { thread } });
    expect(screen.getByText("Task Completed")).toBeTruthy();
    expect(screen.queryByText("Complete Task")).toBeNull();
  });

  it("renders thinking block collapsed by default", () => {
    const thread = makeThread([msg("thinking", "Let me analyze this...", "1:00 PM")]);
    render(ChatArea, { props: { thread } });
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.queryByText("Let me analyze this...")).toBeNull();
  });

  it("expands thinking block on click", async () => {
    const thread = makeThread([msg("thinking", "Let me analyze this...", "1:00 PM")]);
    render(ChatArea, { props: { thread } });
    await fireEvent.click(screen.getByText("Thinking"));
    expect(screen.getByText("Let me analyze this...")).toBeTruthy();
  });

  it("shows working indicator when agent is working", () => {
    const thread = makeThread([msg("assistant", "Working...", "1:00 PM")], {
      processStatus: "working",
    });
    render(ChatArea, { props: { thread } });
    expect(screen.getByText("· · ·")).toBeTruthy();
  });

  it("renders queued message bubble when queuedMessage exists", () => {
    const thread = makeThread([msg("user", "Do task A", "1:00 PM")], {
      processStatus: "working",
      queuedMessage: "Do task B",
    });
    render(ChatArea, { props: { thread } });
    expect(screen.getByText("Do task B")).toBeTruthy();
    expect(screen.getByText("Queued")).toBeTruthy();
  });

  it("does not render queued bubble when queuedMessage is null", () => {
    const thread = makeThread([msg("user", "Do task A", "1:00 PM")], {
      processStatus: "working",
      activeToolCalls: [],
      queuedMessage: null,
    });
    render(ChatArea, { props: { thread } });
    expect(screen.queryByText("Queued")).toBeNull();
  });

  it("renders multiline queued message with whitespace preserved", () => {
    const thread = makeThread([], {
      processStatus: "working",
      queuedMessage: "Do task B\nDo task C",
    });
    render(ChatArea, { props: { thread } });
    expect(screen.getByText(/Do task B/)).toBeTruthy();
    expect(screen.getByText(/Do task C/)).toBeTruthy();
  });

  it("calls onEditQueue when edit button is clicked", async () => {
    let editCalled = false;
    const thread = makeThread([], {
      processStatus: "working",
      queuedMessage: "Do task B",
    });
    render(ChatArea, {
      props: {
        thread,
        onEditQueue: () => {
          editCalled = true;
        },
      },
    });
    await fireEvent.click(screen.getByTitle("Edit queued message"));
    expect(editCalled).toBe(true);
  });

  it("shows connecting banner when agent is initializing", () => {
    const thread = makeThread([], { processStatus: "initializing" });
    render(ChatArea, { props: { thread } });
    expect(screen.getByText(/Connecting to/)).toBeTruthy();
    expect(screen.getByText("Waiting for the agent to start up")).toBeTruthy();
  });

  it("shows ready banner when agent is idle with no messages", () => {
    const thread = makeThread([], { processStatus: "idle" });
    render(ChatArea, { props: { thread } });
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("Test Agent")).toBeTruthy();
  });

  it("does not show ready banner when agent has messages", () => {
    const thread = makeThread([msg("assistant", "Hello", "1:00 PM")], {
      processStatus: "idle",
    });
    render(ChatArea, { props: { thread } });
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("shows error banner with error message when agent has init error", () => {
    const thread = makeThread([], {
      processStatus: "error",
      errorMessage: "Connection refused: binary not found",
    });
    render(ChatArea, { props: { thread } });
    expect(screen.getByText("Failed to connect")).toBeTruthy();
    expect(screen.getByText("Could not start the agent")).toBeTruthy();
    expect(screen.getByText("Connection refused: binary not found")).toBeTruthy();
  });

  it("hides working indicator when agent is idle", () => {
    const thread = makeThread([msg("assistant", "Done", "1:00 PM")], {
      processStatus: "idle",
    });
    render(ChatArea, { props: { thread } });
    expect(screen.queryByText("· · ·")).toBeNull();
  });

  it("renders system message as divider", () => {
    const thread = makeThread(
      [msg("system", "Management permissions have been granted.", "1:00 PM")],
      { processStatus: "idle" },
    );
    render(ChatArea, { props: { thread } });
    expect(screen.getByText("Management permissions have been granted.")).toBeTruthy();
  });

  it("copies fenced code when md-copy is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const prev = navigator.clipboard;
    Object.assign(navigator, {
      clipboard: { writeText },
    });
    const thread = makeThread([msg("assistant", "```rust\nfn x() {}\n```", "1:00 PM")]);
    const { container } = render(ChatArea, { props: { thread } });
    const copyBtn = container.querySelector("button.md-copy");
    expect(copyBtn).toBeTruthy();
    await fireEvent.click(copyBtn!);
    expect(writeText).toHaveBeenCalledWith("fn x() {}");
    Object.assign(navigator, { clipboard: prev });
  });
});
