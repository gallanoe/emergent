import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ThreadListSection from "./ThreadListSection.svelte";
import type { DisplayThread } from "../../stores/types";

function makeThread(overrides?: Partial<DisplayThread>): DisplayThread {
  return {
    id: "t1",
    agentId: "d1",
    workspaceId: "w1",
    cli: "claude-agent-acp",
    provider: "claude",
    name: "Alpha",
    processStatus: "idle",
    preview: "",
    updatedAt: "1m",
    messages: [],
    activeToolCalls: [],
    queuedMessage: null,
    configOptions: [],
    stopReason: null,
    taskId: null,
    ...overrides,
  };
}

describe("ThreadListSection", () => {
  it("renders header and empty hint when there are no threads", () => {
    render(ThreadListSection, {
      props: {
        label: "Conversations",
        threads: [],
        emptyHint: "Nothing here.",
        onSelectThread: vi.fn(),
        onMenu: vi.fn(),
      },
    });
    expect(screen.getByText("Conversations")).toBeTruthy();
    expect(screen.getByText("Nothing here.")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("renders a row per thread", () => {
    const threads = [makeThread({ id: "a", name: "One" }), makeThread({ id: "b", name: "Two" })];
    render(ThreadListSection, {
      props: {
        label: "Conversations",
        threads,
        onSelectThread: vi.fn(),
        onMenu: vi.fn(),
      },
    });
    expect(screen.getByRole("button", { name: "One" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Two" })).toBeTruthy();
  });

  it("dims dead threads", () => {
    const { container } = render(ThreadListSection, {
      props: {
        label: "Conversations",
        threads: [makeThread({ id: "dead-1", name: "Gone", processStatus: "dead" })],
        onSelectThread: vi.fn(),
        onMenu: vi.fn(),
      },
    });
    const row = container.querySelector(".opacity-\\[0\\.55\\]");
    expect(row).toBeTruthy();
  });

  it("row click calls onSelectThread", async () => {
    const onSelectThread = vi.fn();
    render(ThreadListSection, {
      props: {
        label: "Conversations",
        threads: [makeThread({ id: "row-1", name: "Click me" })],
        onSelectThread,
        onMenu: vi.fn(),
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Click me" }));
    expect(onSelectThread).toHaveBeenCalledWith("row-1");
  });

  it("kebab click calls onMenu with coordinates", async () => {
    const onMenu = vi.fn();
    const thread = makeThread({ id: "k1", name: "Kebab row" });
    render(ThreadListSection, {
      props: {
        label: "Conversations",
        threads: [thread],
        onSelectThread: vi.fn(),
        onMenu,
      },
    });
    const kebab = screen.getByTitle("Thread actions");
    await fireEvent.click(kebab);
    expect(onMenu).toHaveBeenCalledTimes(1);
    const [t, x, y] = onMenu.mock.calls[0]!;
    expect(t).toEqual(thread);
    expect(typeof x).toBe("number");
    expect(typeof y).toBe("number");
  });

  it("shows bottom fade when more than seven threads", () => {
    const threads = Array.from({ length: 8 }, (_, i) =>
      makeThread({ id: `many-${i}`, name: `T${i}` }),
    );
    const { container } = render(ThreadListSection, {
      props: {
        label: "Conversations",
        threads,
        onSelectThread: vi.fn(),
        onMenu: vi.fn(),
      },
    });
    const fade = container.querySelector(".pointer-events-none.h-7");
    expect(fade).toBeTruthy();
    expect((fade as HTMLElement).style.background).toContain("linear-gradient");
  });
});
