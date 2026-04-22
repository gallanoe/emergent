import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import OverviewView from "./OverviewView.svelte";
import { mockMetrics } from "../../stores/mock-metrics.svelte";
import type {
  DisplayWorkspace,
  DisplayThread,
  DisplayTask,
  DisplayAgentDefinition,
} from "../../stores/types";

function makeThread(
  id: string,
  name: string,
  processStatus: DisplayThread["processStatus"],
  overrides?: Partial<DisplayThread>,
): DisplayThread {
  return {
    id,
    agentId: "d1",
    workspaceId: "ws1",
    cli: "claude",
    provider: "claude",
    name,
    processStatus,
    preview: "",
    updatedAt: "2m",
    messages: [],
    activeToolCalls: [],
    queuedMessage: null,
    configOptions: [],
    stopReason: null,
    taskId: null,
    ...overrides,
  };
}

function makeAgentDef(
  id: string,
  name: string,
  threads: DisplayThread[],
  overrides?: Partial<DisplayAgentDefinition>,
): DisplayAgentDefinition {
  return {
    id,
    name,
    cli: "claude",
    provider: "claude",
    systemPrompt: "",
    threads,
    ...overrides,
  };
}

function makeWorkspace(overrides?: Partial<DisplayWorkspace>): DisplayWorkspace {
  return {
    id: "ws1",
    name: "emergent-core",
    collapsed: false,
    containerStatus: { state: "running" },
    agentDefinitions: [
      makeAgentDef("d1", "claude-sonnet", [
        makeThread("t-live", "Refine API", "working", { updatedAt: "now" }),
        makeThread("t-idle", "Old task", "idle"),
      ]),
      makeAgentDef(
        "d2",
        "gemini-explorer",
        [makeThread("t2", "Reading", "initializing", { cli: "gemini", provider: "gemini" })],
        {
          cli: "gemini",
          provider: "gemini",
        },
      ),
    ],
    ...overrides,
  };
}

function makeTask(overrides?: Partial<DisplayTask>): DisplayTask {
  return {
    id: "TSK-1",
    title: "Example",
    description: "",
    status: "working",
    parent_id: null,
    blocker_ids: [],
    agent_id: "d1",
    session_id: "t-live",
    workspace_id: "ws1",
    created_at: "2026-04-22T08:00:00Z",
    ...overrides,
  };
}

describe("OverviewView", () => {
  beforeEach(() => {
    mockMetrics.clear();
  });

  it("renders four stat tiles with derived values", () => {
    const tasks: DisplayTask[] = [
      makeTask({ id: "a", status: "working" }),
      makeTask({ id: "b", status: "pending" }),
      makeTask({ id: "c", status: "completed" }),
      makeTask({ id: "d", status: "failed" }),
    ];
    render(OverviewView, {
      props: {
        workspace: makeWorkspace(),
        tasks,
        onSelectThread: vi.fn(),
        onOpenTasks: vi.fn(),
      },
    });
    expect(screen.getByText("Active agents")).toBeTruthy();
    expect(screen.getByText("Live threads")).toBeTruthy();
    expect(screen.getByText("Tasks in flight")).toBeTruthy();
    expect(screen.getByText("Tokens · 24h")).toBeTruthy();
    expect(screen.getByText("of 2 defined")).toBeTruthy();
    expect(screen.getByText("3 total")).toBeTruthy();
    expect(screen.getByText("1 done · 1 failed")).toBeTruthy();
  });

  it("calls onSelectThread when a live session row is clicked", async () => {
    const onSelectThread = vi.fn();
    render(OverviewView, {
      props: {
        workspace: makeWorkspace(),
        tasks: [],
        onSelectThread,
        onOpenTasks: vi.fn(),
      },
    });
    await fireEvent.click(screen.getByText("Refine API"));
    expect(onSelectThread).toHaveBeenCalledWith("t-live");
  });

  it("calls onOpenTasks when Open Tasks is clicked", async () => {
    const onOpenTasks = vi.fn();
    render(OverviewView, {
      props: {
        workspace: makeWorkspace(),
        tasks: [makeTask({})],
        onSelectThread: vi.fn(),
        onOpenTasks,
      },
    });
    await fireEvent.click(screen.getByText("Open Tasks →"));
    expect(onOpenTasks).toHaveBeenCalled();
  });

  it("renders non-zero token bars when mock metrics are seeded", () => {
    mockMetrics.seedAgent("d1", { input: 100, output: 50, cost: 1.25 });
    mockMetrics.seedAgent("d2", { input: 0, output: 0, cost: 0 });
    render(OverviewView, {
      props: {
        workspace: makeWorkspace(),
        tasks: [],
        onSelectThread: vi.fn(),
        onOpenTasks: vi.fn(),
      },
    });
    expect(screen.getAllByText("$1.25").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("claude-sonnet").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("gemini-explorer").length).toBeGreaterThanOrEqual(1);
  });

  it("renders cleanly with zero mock metrics", () => {
    render(OverviewView, {
      props: {
        workspace: makeWorkspace(),
        tasks: [],
        onSelectThread: vi.fn(),
        onOpenTasks: vi.fn(),
      },
    });
    expect(screen.getByText("Tokens · 24h")).toBeTruthy();
    expect(screen.getAllByText("$0.00").length).toBeGreaterThanOrEqual(2);
  });
});
