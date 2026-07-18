import { describe, it, expect, vi } from "vitest";
import { tick } from "svelte";
import { render, fireEvent } from "@testing-library/svelte";
import AgentCreatorView from "./AgentCreatorView.svelte";
import type { AgentProvider } from "../../stores/types";

interface KnownAgent {
  name: string;
  command: string;
  available: boolean;
  provider: AgentProvider;
}

const knownAgents: KnownAgent[] = [
  { name: "Claude Code", command: "claude", available: true, provider: "claude" },
  { name: "Codex", command: "codex", available: true, provider: "codex" },
  { name: "Gemini", command: "gemini", available: false, provider: "gemini" },
];

function setup(agents: KnownAgent[] = knownAgents) {
  const onCreate = vi.fn();
  const onCancel = vi.fn();
  const utils = render(AgentCreatorView, {
    props: { knownAgents: agents, onCreate, onCancel },
  });
  return { ...utils, onCreate, onCancel };
}

const nameInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>("#agent-name")!;
const cliTrigger = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>("#agent-cli")!;

describe("AgentCreatorView", () => {
  it("preselects the first available CLI", async () => {
    const { container, getByText } = setup();
    await tick();
    expect(getByText("New Agent")).toBeTruthy();
    expect(cliTrigger(container).textContent).toContain("Claude Code");
    expect(cliTrigger(container).textContent).toContain("claude");
  });

  it("skips unavailable agents when picking the default", async () => {
    const { container } = setup([
      { name: "Gemini", command: "gemini", available: false, provider: "gemini" },
      { name: "Codex", command: "codex", available: true, provider: "codex" },
    ]);
    await tick();
    expect(cliTrigger(container).textContent).toContain("Codex");
  });

  it("shows a placeholder when no CLI is available", async () => {
    const { container, getByText } = setup([
      { name: "Gemini", command: "gemini", available: false, provider: "gemini" },
    ]);
    await tick();
    expect(getByText("No CLI available")).toBeTruthy();
    expect(cliTrigger(container).textContent).not.toContain("Gemini Code");
  });

  it("toggles the dropdown and lists every known agent", async () => {
    const { container, getByText, queryByText } = setup();
    await tick();
    expect(queryByText("not installed")).toBeNull();

    await fireEvent.click(cliTrigger(container));
    expect(getByText("Codex")).toBeTruthy();
    // Unavailable agents are listed but flagged and disabled.
    expect(getByText("not installed")).toBeTruthy();
    const geminiBtn = getByText("Gemini").closest("button") as HTMLButtonElement;
    expect(geminiBtn.disabled).toBe(true);

    await fireEvent.click(cliTrigger(container));
    await tick();
    expect(queryByText("not installed")).toBeNull();
  });

  it("selecting an available agent updates the trigger and closes the dropdown", async () => {
    const { container, getByText, queryByText } = setup();
    await tick();
    await fireEvent.click(cliTrigger(container));
    await fireEvent.click(getByText("Codex"));
    await tick();

    expect(queryByText("not installed")).toBeNull();
    expect(cliTrigger(container).textContent).toContain("Codex");
  });

  it("clicking an unavailable agent leaves the selection unchanged", async () => {
    const { container, getByText } = setup();
    await tick();
    await fireEvent.click(cliTrigger(container));
    const geminiBtn = getByText("Gemini").closest("button") as HTMLButtonElement;
    // Fire directly: the DOM `disabled` attribute would otherwise swallow the click.
    geminiBtn.disabled = false;
    await fireEvent.click(geminiBtn);
    await tick();
    expect(cliTrigger(container).textContent).toContain("Claude Code");
  });

  it("closes the dropdown when the backdrop is clicked", async () => {
    const { container, queryByText } = setup();
    await tick();
    await fireEvent.click(cliTrigger(container));
    const backdrop = container.querySelector(".fixed.inset-0")!;
    await fireEvent.click(backdrop);
    await tick();
    expect(queryByText("not installed")).toBeNull();
  });

  it("disables Create until a non-blank name is entered", async () => {
    const { container, getByRole } = setup();
    await tick();
    const create = getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    await fireEvent.input(nameInput(container), { target: { value: "   " } });
    await tick();
    expect(create.disabled).toBe(true);

    await fireEvent.input(nameInput(container), { target: { value: "Reviewer" } });
    await tick();
    expect(create.disabled).toBe(false);
    expect(create.getAttribute("class")).toContain("bg-accent");
  });

  it("creates with the trimmed name and the selected agent's provider", async () => {
    const { container, getByRole, getByText, onCreate } = setup();
    await tick();
    await fireEvent.click(cliTrigger(container));
    await fireEvent.click(getByText("Codex"));
    await fireEvent.input(nameInput(container), { target: { value: "  Reviewer  " } });
    await tick();

    await fireEvent.click(getByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledWith("Reviewer", "codex");
  });

  it("does not create when no CLI is available", async () => {
    const { container, getByRole, onCreate } = setup([
      { name: "Gemini", command: "gemini", available: false, provider: "gemini" },
    ]);
    await tick();
    await fireEvent.input(nameInput(container), { target: { value: "Reviewer" } });
    await tick();
    const create = getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await fireEvent.click(create);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("calls onCancel from the Cancel button", async () => {
    const { getByRole, onCancel } = setup();
    await tick();
    await fireEvent.click(getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape closes the dropdown first, then cancels", async () => {
    const { container, queryByText, onCancel } = setup();
    await tick();
    await fireEvent.click(cliTrigger(container));
    expect(queryByText("not installed")).toBeTruthy();

    await fireEvent.keyDown(window, { key: "Escape" });
    await tick();
    expect(queryByText("not installed")).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();

    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores non-Escape keys", async () => {
    const { onCancel } = setup();
    await tick();
    await fireEvent.keyDown(window, { key: "Enter" });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
