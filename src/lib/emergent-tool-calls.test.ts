import { describe, it, expect } from "vitest";
import {
  getEmergentToolName,
  emergentToolDisplayName,
  parseAgentsToolContent,
  parseTasksToolContent,
  parseCreateTaskToolContent,
  parseCompleteTaskToolContent,
  parseCreateTaskToolInput,
  parseUpdateTaskToolInput,
  parseUpdateTaskToolContent,
} from "./emergent-tool-calls";
import type { DisplayToolCall } from "../stores/types";

function makeToolCall(overrides: Partial<DisplayToolCall> = {}): DisplayToolCall {
  return {
    id: "tc-1",
    name: "mcp__emergent__list_tasks",
    kind: "other",
    status: "completed",
    locations: [],
    content: [],
    ...overrides,
  };
}

function withText(text: string): DisplayToolCall {
  return makeToolCall({ content: [{ type: "text", text }] });
}

describe("getEmergentToolName", () => {
  it("maps each MCP-prefixed tool name to its bare emergent name", () => {
    expect(getEmergentToolName("mcp__emergent__create_task")).toBe("create_task");
    expect(getEmergentToolName("mcp__emergent__list_tasks")).toBe("list_tasks");
    expect(getEmergentToolName("mcp__emergent__complete_task")).toBe("complete_task");
    expect(getEmergentToolName("mcp__emergent__update_task")).toBe("update_task");
    expect(getEmergentToolName("mcp__emergent__list_agents")).toBe("list_agents");
  });

  it("matches on the suffix so any server prefix works", () => {
    expect(getEmergentToolName("create_task")).toBe("create_task");
    expect(getEmergentToolName("some.other.server-list_agents")).toBe("list_agents");
  });

  it("is case-insensitive", () => {
    expect(getEmergentToolName("MCP__Emergent__CREATE_TASK")).toBe("create_task");
  });

  it("returns null for a tool that is not an emergent tool", () => {
    expect(getEmergentToolName("read_file")).toBeNull();
    expect(getEmergentToolName("")).toBeNull();
    // `create_task_v2` does not *end* with a known name, so it is not matched.
    expect(getEmergentToolName("create_task_v2")).toBeNull();
  });
});

describe("emergentToolDisplayName", () => {
  it("title-cases each snake_case segment", () => {
    expect(emergentToolDisplayName("create_task")).toBe("Create Task");
    expect(emergentToolDisplayName("list_agents")).toBe("List Agents");
    expect(emergentToolDisplayName("complete_task")).toBe("Complete Task");
    expect(emergentToolDisplayName("update_task")).toBe("Update Task");
    expect(emergentToolDisplayName("list_tasks")).toBe("List Tasks");
  });
});

describe("parseAgentsToolContent", () => {
  it("parses a JSON agent array out of the first text content item", () => {
    const agents = parseAgentsToolContent(withText(JSON.stringify([{ id: "a-1", name: "Scout" }])));
    expect(agents).toEqual([{ id: "a-1", name: "Scout" }]);
  });

  it("skips non-text content and reads the first text item", () => {
    const call = makeToolCall({
      content: [
        { type: "diff", path: "a.ts", oldText: null, newText: "x" },
        { type: "text", text: JSON.stringify([{ id: "a-2", name: "Pilot" }]) },
      ],
    });
    expect(parseAgentsToolContent(call)).toEqual([{ id: "a-2", name: "Pilot" }]);
  });

  it("returns an empty array when there is no text content", () => {
    expect(parseAgentsToolContent(makeToolCall())).toEqual([]);
  });

  it("returns an empty array when the text is not valid JSON", () => {
    expect(parseAgentsToolContent(withText("not json at all"))).toEqual([]);
  });

  it("returns an empty array when the text content is an empty string", () => {
    expect(parseAgentsToolContent(withText(""))).toEqual([]);
  });
});

describe("parseTasksToolContent", () => {
  it("parses a JSON task array", () => {
    const tasks = parseTasksToolContent(withText(JSON.stringify([{ id: "T-1", title: "Ship" }])));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe("T-1");
  });

  it("returns an empty array on malformed JSON", () => {
    expect(parseTasksToolContent(withText("{oops"))).toEqual([]);
  });
});

describe("parseCreateTaskToolContent", () => {
  it("prefers the structured rawOutput over text content", () => {
    const call = makeToolCall({
      rawOutput: { task_id: "FROM-RAW" },
      content: [{ type: "text", text: JSON.stringify({ task_id: "FROM-TEXT" }) }],
    });
    expect(parseCreateTaskToolContent(call)?.task_id).toBe("FROM-RAW");
  });

  it("falls back to parsing the text content when rawOutput is absent", () => {
    expect(
      parseCreateTaskToolContent(withText(JSON.stringify({ task_id: "FROM-TEXT" })))?.task_id,
    ).toBe("FROM-TEXT");
  });

  it("returns null when neither rawOutput nor parseable text is present", () => {
    expect(parseCreateTaskToolContent(makeToolCall())).toBeNull();
    expect(parseCreateTaskToolContent(withText("<html>"))).toBeNull();
  });
});

describe("parseCompleteTaskToolContent", () => {
  it("prefers rawOutput", () => {
    const call = makeToolCall({ rawOutput: { task_id: "T-9", status: "completed" } });
    expect(parseCompleteTaskToolContent(call)).toEqual({ task_id: "T-9", status: "completed" });
  });

  it("falls back to the text content", () => {
    const call = withText(JSON.stringify({ task_id: "T-10", status: "failed" }));
    expect(parseCompleteTaskToolContent(call)?.status).toBe("failed");
  });

  it("returns null when there is nothing to parse", () => {
    expect(parseCompleteTaskToolContent(makeToolCall())).toBeNull();
  });
});

describe("parseCreateTaskToolInput", () => {
  it("returns the rawInput as a typed create-task input", () => {
    const call = makeToolCall({
      rawInput: { title: "Build", description: "do it", agent_id: "a-1" },
    });
    expect(parseCreateTaskToolInput(call)).toEqual({
      title: "Build",
      description: "do it",
      agent_id: "a-1",
    });
  });

  it("returns null when rawInput is missing", () => {
    expect(parseCreateTaskToolInput(makeToolCall())).toBeNull();
  });

  it("returns null when rawInput is explicitly null", () => {
    expect(parseCreateTaskToolInput(makeToolCall({ rawInput: null }))).toBeNull();
  });
});

describe("parseUpdateTaskToolInput", () => {
  it("returns the rawInput as a typed update-task input", () => {
    const call = makeToolCall({ rawInput: { description: "halfway there" } });
    expect(parseUpdateTaskToolInput(call)?.description).toBe("halfway there");
  });

  it("returns null when rawInput is missing", () => {
    expect(parseUpdateTaskToolInput(makeToolCall())).toBeNull();
  });
});

describe("parseUpdateTaskToolContent", () => {
  it("prefers rawOutput over text content", () => {
    const call = makeToolCall({
      rawOutput: { task_id: "U-1", status: "working" },
      content: [{ type: "text", text: JSON.stringify({ task_id: "U-2", status: "pending" }) }],
    });
    expect(parseUpdateTaskToolContent(call)?.task_id).toBe("U-1");
  });

  it("falls back to the text content", () => {
    const call = withText(JSON.stringify({ task_id: "U-3", status: "working" }));
    expect(parseUpdateTaskToolContent(call)).toEqual({ task_id: "U-3", status: "working" });
  });

  it("returns null when neither source parses", () => {
    expect(parseUpdateTaskToolContent(withText("nope"))).toBeNull();
  });
});
