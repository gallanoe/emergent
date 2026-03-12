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

  describe("Task 2: workspace list with selection and timestamps", () => {
    it("renders workspace names sorted by last_opened descending", () => {
      useWorkspaceStore.setState({
        workspaces: [
          {
            id: "a",
            name: "Alpha",
            created_at: "2024-01-01T00:00:00Z",
            last_opened: "2024-01-01T00:00:00Z",
          },
          {
            id: "b",
            name: "Beta",
            created_at: "2024-01-01T00:00:00Z",
            last_opened: "2024-06-01T00:00:00Z",
          },
        ],
        activeWorkspace: null,
        currentBranch: "main",
        mergeState: null,
      });
      render(<WorkspacePicker />);
      const options = screen.getAllByRole("option");
      expect(options[0]!.textContent).toContain("Beta");
      expect(options[1]!.textContent).toContain("Alpha");
    });

    it("pre-selects the first workspace", () => {
      useWorkspaceStore.setState({
        workspaces: [
          {
            id: "a",
            name: "Alpha",
            created_at: "2024-01-01T00:00:00Z",
            last_opened: "2024-01-01T00:00:00Z",
          },
          {
            id: "b",
            name: "Beta",
            created_at: "2024-01-01T00:00:00Z",
            last_opened: "2024-06-01T00:00:00Z",
          },
        ],
        activeWorkspace: null,
        currentBranch: "main",
        mergeState: null,
      });
      render(<WorkspacePicker />);
      const options = screen.getAllByRole("option");
      expect(options[0]!.getAttribute("aria-selected")).toBe("true");
      expect(options[1]!.getAttribute("aria-selected")).toBe("false");
    });
  });
});
