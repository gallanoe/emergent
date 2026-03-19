import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ChatArea from "./ChatArea.svelte";
import type { DisplayAgent, DisplayMessage } from "../stores/types";

function makeAgent(messages: DisplayMessage[], overrides?: Partial<DisplayAgent>): DisplayAgent {
  return {
    id: "agent-1",
    swarmId: "swarm-1",
    name: "Test Agent",
    status: "idle",
    preview: "test...",
    updatedAt: "1m ago",
    messages,
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

  it("renders tool call groups with count", () => {
    const agent = makeAgent([
      msg("assistant", "Let me check", "1:00 PM"),
      msg("tool-group", "", "1:00 PM", {
        toolCalls: [
          { id: "tc1", name: "Read file", status: "completed" },
          { id: "tc2", name: "Write file", status: "completed" },
        ],
      }),
    ]);
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("2 tool calls")).toBeTruthy();
  });

  it("shows singular 'tool call' for single tool call", () => {
    const agent = makeAgent([
      msg("assistant", "Checking...", "1:00 PM"),
      msg("tool-group", "", "1:00 PM", {
        toolCalls: [{ id: "tc1", name: "Read file", status: "completed" }],
      }),
    ]);
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("1 tool call")).toBeTruthy();
  });

  it("expands tool calls on click", async () => {
    const agent = makeAgent([
      msg("assistant", "Checking...", "1:00 PM"),
      msg("tool-group", "", "1:00 PM", {
        toolCalls: [{ id: "tc1", name: "Read file", status: "completed" }],
      }),
    ]);
    render(ChatArea, { props: { agent } });

    // Tool name not visible initially
    expect(screen.queryByText("Read file")).toBeNull();

    // Click to expand
    await fireEvent.click(screen.getByText("1 tool call"));
    expect(screen.getByText("Read file")).toBeTruthy();
  });

  it("deduplicates timestamps for same-time messages", () => {
    const agent = makeAgent([
      msg("assistant", "First", "1:00 PM"),
      msg("assistant", "Second", "1:00 PM"),
    ]);
    render(ChatArea, { props: { agent } });

    const timestamps = screen.getAllByText("1:00 PM");
    expect(timestamps).toHaveLength(1);
  });

  it("shows both timestamps when times differ", () => {
    const agent = makeAgent([
      msg("assistant", "First", "1:00 PM"),
      msg("assistant", "Second", "1:01 PM"),
    ]);
    render(ChatArea, { props: { agent } });

    expect(screen.getByText("1:00 PM")).toBeTruthy();
    expect(screen.getByText("1:01 PM")).toBeTruthy();
  });

  it("shows working indicator when agent is working", () => {
    const agent = makeAgent([msg("assistant", "Working...", "1:00 PM")], {
      status: "working",
    });
    render(ChatArea, { props: { agent } });
    expect(screen.getByText("· · ·")).toBeTruthy();
  });

  it("hides working indicator when agent is idle", () => {
    const agent = makeAgent([msg("assistant", "Done", "1:00 PM")], {
      status: "idle",
    });
    render(ChatArea, { props: { agent } });
    expect(screen.queryByText("· · ·")).toBeNull();
  });
});
