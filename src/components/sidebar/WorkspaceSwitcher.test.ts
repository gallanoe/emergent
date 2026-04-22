import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import WorkspaceSwitcher from "./WorkspaceSwitcher.svelte";
import type { ContainerStatus, DisplayWorkspace } from "../../stores/types";

function makeWorkspace(
  id: string,
  name: string,
  containerStatus: ContainerStatus = { state: "running" },
  overrides?: Partial<DisplayWorkspace>,
): DisplayWorkspace {
  return {
    id,
    name,
    collapsed: false,
    containerStatus,
    agentDefinitions: [],
    ...overrides,
  };
}

describe("WorkspaceSwitcher", () => {
  it("renders the selected workspace name and glyph", () => {
    const ws = [
      makeWorkspace("a", "Alpha", { state: "running" }),
      makeWorkspace("b", "Bravo", { state: "building" }),
    ];
    render(WorkspaceSwitcher, {
      props: {
        workspaces: ws,
        selectedId: "a",
        onSelect: () => {},
        onOpenWorkspaceSettings: () => {},
        onCreateWorkspace: () => {},
      },
    });
    expect(screen.getByText("Alpha")).toBeTruthy();
  });

  it("calls onSelect with selected id when the name zone is clicked", async () => {
    const onSelect = vi.fn();
    const ws = [
      makeWorkspace("a", "Alpha", { state: "running" }),
      makeWorkspace("b", "Bravo", { state: "building" }),
    ];
    render(WorkspaceSwitcher, {
      props: {
        workspaces: ws,
        selectedId: "a",
        onSelect,
        onOpenWorkspaceSettings: () => {},
        onCreateWorkspace: () => {},
      },
    });
    await fireEvent.click(screen.getByTitle("Workspace overview"));
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("toggles the popover when the caret is clicked", async () => {
    const ws = [
      makeWorkspace("a", "Alpha", { state: "running" }),
      makeWorkspace("b", "Bravo", { state: "building" }),
    ];
    render(WorkspaceSwitcher, {
      props: {
        workspaces: ws,
        selectedId: "a",
        onSelect: () => {},
        onOpenWorkspaceSettings: () => {},
        onCreateWorkspace: () => {},
      },
    });
    const caret = screen.getByTitle("Switch workspace");
    expect(screen.queryByText("New workspace")).toBeNull();
    await fireEvent.click(caret);
    expect(screen.getByText("Bravo")).toBeTruthy();
    expect(screen.getByText("Workspace settings")).toBeTruthy();
    expect(screen.getByText("New workspace")).toBeTruthy();
  });

  it("lists all workspaces in the popover and calls onSelect for a row click", async () => {
    const onSelect = vi.fn();
    const ws = [
      makeWorkspace("a", "Alpha", { state: "running" }),
      makeWorkspace("b", "Bravo", { state: "building" }),
    ];
    render(WorkspaceSwitcher, {
      props: {
        workspaces: ws,
        selectedId: "a",
        onSelect,
        onOpenWorkspaceSettings: () => {},
        onCreateWorkspace: () => {},
      },
    });
    await fireEvent.click(screen.getByTitle("Switch workspace"));
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Building")).toBeTruthy();
    await fireEvent.click(screen.getByText("Bravo"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("calls onCreateWorkspace when 'New workspace' is clicked", async () => {
    const onCreateWorkspace = vi.fn();
    const ws = [makeWorkspace("a", "Alpha", { state: "running" })];
    render(WorkspaceSwitcher, {
      props: {
        workspaces: ws,
        selectedId: "a",
        onSelect: () => {},
        onOpenWorkspaceSettings: () => {},
        onCreateWorkspace,
      },
    });
    await fireEvent.click(screen.getByTitle("Switch workspace"));
    await fireEvent.click(screen.getByText("New workspace"));
    expect(onCreateWorkspace).toHaveBeenCalled();
  });

  it("calls onOpenWorkspaceSettings when the workspace settings row is clicked", async () => {
    const onOpenWorkspaceSettings = vi.fn();
    const ws = [makeWorkspace("a", "Alpha", { state: "running" })];
    render(WorkspaceSwitcher, {
      props: {
        workspaces: ws,
        selectedId: "a",
        onSelect: () => {},
        onOpenWorkspaceSettings,
        onCreateWorkspace: () => {},
      },
    });
    await fireEvent.click(screen.getByTitle("Switch workspace"));
    expect(screen.getByText("Workspace settings")).toBeTruthy();
    await fireEvent.click(screen.getByText("Workspace settings"));
    expect(onOpenWorkspaceSettings).toHaveBeenCalledOnce();
  });
});
