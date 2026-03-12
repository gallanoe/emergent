import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useWorkspaceStore } from "../../stores/workspace";
import WorkspacePicker from "../../components/WorkspacePicker";

vi.mock("../../lib/tauri", () => ({
  listWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  openWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

describe("WorkspacePicker", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      activeWorkspace: null,
      workspaces: [],
      currentBranch: "main",
      mergeState: null,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Task 1: static rendering", () => {
    it("renders title and subtitle", () => {
      render(<WorkspacePicker />);
      expect(screen.getByText("Open a workspace")).toBeDefined();
      expect(screen.getByText("Or create a new one to get started")).toBeDefined();
    });

    it("renders empty state when no workspaces", () => {
      render(<WorkspacePicker />);
      expect(screen.getByText("No workspaces yet")).toBeDefined();
    });

    it("renders new workspace link", () => {
      render(<WorkspacePicker />);
      expect(screen.getByText("New workspace")).toBeDefined();
    });
  });
});
