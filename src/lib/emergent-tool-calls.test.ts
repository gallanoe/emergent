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

/**
 * A task as the Rust `Task` struct actually serializes it — `status` is the
 * flattened TaskState tag, and `workspace_id` is the transparent WorkspaceId
 * newtype. Tests override individual fields to probe the validator.
 */
function wireTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "T-1",
    title: "Ship",
    description: "Ship the thing",
    status: "working",
    parent_id: null,
    blocker_ids: [],
    agent_id: "agent-1",
    session_id: "th-1",
    workspace_id: "ws-1",
    created_at: "2026-07-18T00:00:00Z",
    ...overrides,
  };
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
    const tasks = parseTasksToolContent(withText(JSON.stringify([wireTask({ id: "T-1" })])));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe("T-1");
  });

  it("drops entries that are not well-formed tasks, keeping the rest", () => {
    // A partial object used to be cast straight through and handed to the
    // render layer typed as a DisplayTask it did not satisfy.
    const tasks = parseTasksToolContent(
      withText(JSON.stringify([{ id: "T-1", title: "Ship" }, wireTask({ id: "T-2" })])),
    );
    expect(tasks.map((t) => t.id)).toEqual(["T-2"]);
  });

  it("accepts the wire shape for a pending task, which omits session_id entirely", () => {
    // Rust marks parent_id/session_id skip_serializing_if = Option::is_none, so
    // they are absent rather than null. Both normalize to null.
    const wire = wireTask({ id: "T-3", status: "pending" });
    delete (wire as Record<string, unknown>).session_id;
    delete (wire as Record<string, unknown>).parent_id;

    const [task] = parseTasksToolContent(withText(JSON.stringify([wire])));
    expect(task).toBeDefined();
    expect(task!.session_id).toBeNull();
    expect(task!.parent_id).toBeNull();
  });

  it("accepts the exact JSON the Rust serializer emits for a pending task", () => {
    // Captured from `serde_json::to_string(&Task { state: Pending, .. })`. Kept
    // verbatim: if the Rust shape drifts, this fails rather than silently
    // filtering every task out of the list.
    const wire =
      '[{"id":"t1","title":"x","description":"y","status":"pending","blocker_ids":[],' +
      '"agent_id":"a1","workspace_id":"ws1","created_at":"2026-01-01T00:00:00Z"}]';
    const [task] = parseTasksToolContent(withText(wire));
    expect(task).toEqual({
      id: "t1",
      title: "x",
      description: "y",
      status: "pending",
      parent_id: null,
      blocker_ids: [],
      agent_id: "a1",
      session_id: null,
      workspace_id: "ws1",
      created_at: "2026-01-01T00:00:00Z",
    });
  });

  it("ignores wire fields the frontend does not model", () => {
    const wire = { ...wireTask({ id: "T-4" }), summary: "done", creator_thread_id: "th-1" };
    const [task] = parseTasksToolContent(withText(JSON.stringify([wire])));
    expect(task!.id).toBe("T-4");
    expect(task).not.toHaveProperty("summary");
  });

  it("rejects a task carrying an unknown status", () => {
    const wire = wireTask({ id: "T-5", status: "exploded" });
    expect(parseTasksToolContent(withText(JSON.stringify([wire])))).toEqual([]);
  });

  it("returns an empty list when the payload is not an array", () => {
    expect(parseTasksToolContent(withText(JSON.stringify({ id: "T-1" })))).toEqual([]);
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

  it("falls through to the text content when rawOutput is the wrong shape", () => {
    // Previously any non-null rawOutput won outright and was cast unchecked,
    // so a malformed one shadowed a perfectly good text payload.
    const call = makeToolCall({
      rawOutput: { unexpected: true },
      content: [{ type: "text", text: JSON.stringify({ task_id: "FROM-TEXT" }) }],
    });
    expect(parseCreateTaskToolContent(call)?.task_id).toBe("FROM-TEXT");
  });

  it("rejects a rawOutput whose task_id is not a string", () => {
    expect(parseCreateTaskToolContent(makeToolCall({ rawOutput: { task_id: 42 } }))).toBeNull();
  });

  it("rejects array and primitive payloads", () => {
    expect(
      parseCreateTaskToolContent(makeToolCall({ rawOutput: [{ task_id: "T-1" }] })),
    ).toBeNull();
    expect(parseCreateTaskToolContent(makeToolCall({ rawOutput: "T-1" }))).toBeNull();
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

  it("accepts blocker_ids omitted, null, or a string array", () => {
    const base = { title: "Build", description: "do it", agent_id: "a-1" };
    expect(parseCreateTaskToolInput(makeToolCall({ rawInput: base }))?.blocker_ids).toBeUndefined();
    expect(
      parseCreateTaskToolInput(makeToolCall({ rawInput: { ...base, blocker_ids: null } })),
    ).not.toBeNull();
    expect(
      parseCreateTaskToolInput(makeToolCall({ rawInput: { ...base, blocker_ids: ["T-1"] } }))
        ?.blocker_ids,
    ).toEqual(["T-1"]);
  });

  it("rejects rawInput missing a required field or with a mistyped one", () => {
    expect(
      parseCreateTaskToolInput(makeToolCall({ rawInput: { title: "Build", description: "d" } })),
    ).toBeNull();
    expect(
      parseCreateTaskToolInput(
        makeToolCall({ rawInput: { title: 1, description: "d", agent_id: "a-1" } }),
      ),
    ).toBeNull();
    expect(
      parseCreateTaskToolInput(
        makeToolCall({
          rawInput: { title: "B", description: "d", agent_id: "a-1", blocker_ids: [1, 2] },
        }),
      ),
    ).toBeNull();
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
