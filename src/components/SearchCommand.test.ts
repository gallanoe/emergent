import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import SearchCommand from "./SearchCommand.svelte";

type ThreadHit = {
  id: string;
  name: string;
  agentId: string;
  agentName: string;
  agentProvider: string;
  status: "idle" | "working" | "initializing" | "error" | "dead";
};

const THREADS: ThreadHit[] = [
  {
    id: "t1",
    name: "fix login bug",
    agentId: "a1",
    agentName: "Claude",
    agentProvider: "claude",
    status: "idle",
  },
  {
    id: "t2",
    name: "refactor api",
    agentId: "a1",
    agentName: "Claude",
    agentProvider: "claude",
    status: "working",
  },
  {
    id: "t3",
    name: "docs pass",
    agentId: "a2",
    agentName: "Gemini",
    agentProvider: "gemini",
    status: "idle",
  },
];

function renderPalette(
  overrides: Partial<{
    threads: ThreadHit[];
    onSelect: (id: string) => void;
    onClose: () => void;
  }> = {},
) {
  return render(SearchCommand, {
    props: {
      threads: overrides.threads ?? THREADS,
      onSelect: overrides.onSelect ?? (() => {}),
      onClose: overrides.onClose ?? (() => {}),
    },
  });
}

describe("SearchCommand", () => {
  it("lists every thread when the query is empty", () => {
    renderPalette();
    expect(screen.getByText("fix login bug")).toBeTruthy();
    expect(screen.getByText("refactor api")).toBeTruthy();
    expect(screen.getByText("docs pass")).toBeTruthy();
  });

  it("filters threads by case-insensitive substring match on name", async () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/search threads/i);
    await fireEvent.input(input, { target: { value: "API" } });
    expect(screen.queryByText("fix login bug")).toBeNull();
    expect(screen.getByText("refactor api")).toBeTruthy();
  });

  it("calls onSelect with the thread id when a result row is clicked", async () => {
    const onSelect = vi.fn();
    renderPalette({ onSelect });
    await fireEvent.click(screen.getByText("docs pass"));
    expect(onSelect).toHaveBeenCalledWith("t3");
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    renderPalette({ onClose });
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows an empty state when no thread matches", async () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/search threads/i);
    await fireEvent.input(input, { target: { value: "zzzz" } });
    expect(screen.getByText(/no results/i)).toBeTruthy();
  });

  it("moves selection with arrow keys and selects with Enter", async () => {
    const onSelect = vi.fn();
    renderPalette({ onSelect });
    await fireEvent.keyDown(window, { key: "ArrowDown" });
    await fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("t2");
  });
});
