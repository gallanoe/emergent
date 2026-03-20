import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import AgentPickerPopover from "./AgentPickerPopover.svelte";

interface KnownAgent {
  name: string;
  binary: string;
  available: boolean;
}

const agents: KnownAgent[] = [
  { name: "Claude Code", binary: "claude-agent-acp", available: true },
  { name: "Codex", binary: "codex-acp", available: false },
];

function renderPopover(
  overrides: Partial<{
    agents: KnownAgent[];
    onSelect: (binary: string) => void;
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

  it("renders binary names", () => {
    renderPopover();
    expect(screen.getByText("claude-agent-acp")).toBeTruthy();
    expect(screen.getByText("codex-acp")).toBeTruthy();
  });

  it("calls onSelect with binary when clicking available agent", async () => {
    const onSelect = vi.fn();
    renderPopover({ onSelect });
    await fireEvent.click(screen.getByText("Claude Code"));
    expect(onSelect).toHaveBeenCalledWith("claude-agent-acp");
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
