import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ChatArea from "./ChatArea.svelte";
import type { DisplayAgent, DisplayMessage } from "../../stores/types";

function makeAgent(messages: DisplayMessage[], overrides?: Partial<DisplayAgent>): DisplayAgent {
  return {
    id: "agent-1",
    workspaceId: "swarm-1",
    cli: "claude-agent-acp",
    name: "Test Agent",
    status: "idle",
    preview: "test...",
    updatedAt: "1m ago",
    messages,
    activeToolCalls: [],
    queuedMessage: null,
    configOptions: [],
    hasManagementPermissions: false,
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
