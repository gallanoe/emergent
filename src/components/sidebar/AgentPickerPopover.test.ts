import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import AgentPickerPopover from "./AgentPickerPopover.svelte";

interface KnownAgent {
  name: string;
  command: string;
  available: boolean;
}

const agents: KnownAgent[] = [
  { name: "Claude Code", command: "claude-agent-acp", available: true },
  { name: "Codex", command: "codex-acp", available: false },
];

function renderPopover(
  overrides: Partial<{
    agents: KnownAgent[];
    onSelect: (command: string) => void;
    onClose: () => void;
  }> = {},
) {
  return render(AgentPickerPopover, {
    props: {
      agents: overrides.agents ?? agents,
      onSelect: overrides.onSelect ?? (() => {}),
      onClose: overrides.onClose ?? (() => {}),
    },
  });
}

describe("AgentPickerPopover", () => {
  it("renders all agent names", () => {
    renderPopover();
    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
  });

  it("renders command strings", () => {
    renderPopover();
    expect(screen.getByText("claude-agent-acp")).toBeTruthy();
    expect(screen.getByText("codex-acp")).toBeTruthy();
  });

  it("calls onSelect with command when clicking available agent", async () => {
    const onSelect = vi.fn();
    renderPopover({ onSelect });
    await fireEvent.click(screen.getByText("Claude Code"));
    expect(onSelect).toHaveBeenCalledWith("claude-agent-acp", "Claude Code");
  });

  it("does not call onSelect when clicking unavailable agent", async () => {
    const onSelect = vi.fn();
    renderPopover({ onSelect });
    await fireEvent.click(screen.getByText("Codex"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks unavailable agents with disabled styling", () => {
    renderPopover();
    const codexItem = screen.getByText("Codex").closest("[data-agent]");
    expect(codexItem?.getAttribute("data-available")).toBe("false");
  });
});
