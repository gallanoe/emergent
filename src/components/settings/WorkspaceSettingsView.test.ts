import { describe, it, expect, vi, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, screen, fireEvent } from "@testing-library/svelte";
import WorkspaceSettingsView from "./WorkspaceSettingsView.svelte";
import type { WorkspaceInfo } from "../../stores/types";

const sampleWorkspace: WorkspaceInfo = {
  id: "ws-1",
  name: "Alpha Lab",
  path: "/tmp/alpha",
  container_id: null,
  container_status: { state: "stopped" },
};

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

const noop = () => {};

const baseProps = {
  workspaceId: "ws-1",
  containerStatus: { state: "stopped" as const },
  runtimePreference: { selected_runtime: "docker" as const },
  runtimeStatus: null,
  onUpdateName: noop,
  onRuntimeChange: noop,
  onStart: noop,
  onStop: noop,
  onRebuild: noop,
  onDelete: noop,
};

describe("WorkspaceSettingsView", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_workspace") return sampleWorkspace;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
  });

  it("renders workspace, runtime, and danger sections", async () => {
    render(WorkspaceSettingsView, { props: baseProps });
    await tick();
    await tick();
    expect(screen.getByText("Workspace")).toBeTruthy();
    expect(screen.getByText("Container runtime")).toBeTruthy();
    expect(screen.getByText("Danger zone")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Alpha Lab" })).toBeTruthy();
    expect(screen.getAllByText("/tmp/alpha").length).toBeGreaterThanOrEqual(1);
  });

  it("name row Edit toggles inline edit and blur commits", async () => {
    const onUpdateName = vi.fn();
    render(WorkspaceSettingsView, {
      props: { ...baseProps, onUpdateName },
    });
    await tick();
    await tick();

    await fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByDisplayValue("Alpha Lab");
    await fireEvent.input(input, { target: { value: "Beta Lab" } });
    await fireEvent.blur(input);
    expect(onUpdateName).toHaveBeenCalledWith("Beta Lab");
  });

  it("Delete opens confirm dialog", async () => {
    render(WorkspaceSettingsView, { props: baseProps });
    await tick();
    await tick();

    await fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(screen.getByText("Delete Alpha Lab?")).toBeTruthy();
  });
});
