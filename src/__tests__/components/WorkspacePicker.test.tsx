import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useWorkspaceStore } from "../../stores/workspace";
import { WorkspacePicker } from "../../components/WorkspacePicker";
import { openWorkspace } from "../../lib/tauri";

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

  describe("Task 3: keyboard navigation", () => {
    const twoWorkspaces = [
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
    ];

    it("moves selection down with ArrowDown", () => {
      useWorkspaceStore.setState({
        workspaces: twoWorkspaces,
        activeWorkspace: null,
        currentBranch: "main",
        mergeState: null,
      });
      render(<WorkspacePicker />);
      const options = screen.getAllByRole("option");
      expect(options[0]!.getAttribute("aria-selected")).toBe("true");

      fireEvent.keyDown(window, { key: "ArrowDown" });
      expect(options[1]!.getAttribute("aria-selected")).toBe("true");
      expect(options[0]!.getAttribute("aria-selected")).toBe("false");
    });

    it("moves selection up with ArrowUp", () => {
      useWorkspaceStore.setState({
        workspaces: twoWorkspaces,
        activeWorkspace: null,
        currentBranch: "main",
        mergeState: null,
      });
      render(<WorkspacePicker />);

      // Move down first, then up
      fireEvent.keyDown(window, { key: "ArrowDown" });
      fireEvent.keyDown(window, { key: "ArrowUp" });

      const options = screen.getAllByRole("option");
      expect(options[0]!.getAttribute("aria-selected")).toBe("true");
    });

    it("wraps selection at boundaries", () => {
      useWorkspaceStore.setState({
        workspaces: twoWorkspaces,
        activeWorkspace: null,
        currentBranch: "main",
        mergeState: null,
      });
      render(<WorkspacePicker />);

      // ArrowUp from index 0 should wrap to last
      fireEvent.keyDown(window, { key: "ArrowUp" });
      const options = screen.getAllByRole("option");
      expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    });

    it("opens workspace on Enter", async () => {
      useWorkspaceStore.setState({
        workspaces: twoWorkspaces,
        activeWorkspace: null,
        currentBranch: "main",
        mergeState: null,
      });
      const mockMeta = {
        id: "b",
        name: "Beta",
        created_at: "2024-01-01T00:00:00Z",
        last_opened: "2024-06-01T00:00:00Z",
      };
      vi.mocked(openWorkspace).mockResolvedValue(mockMeta);

      render(<WorkspacePicker />);

      // First item (Beta, sorted by last_opened desc) is selected by default
      fireEvent.keyDown(window, { key: "Enter" });

      await waitFor(() => {
        expect(openWorkspace).toHaveBeenCalledWith("b");
      });
    });
  });
});
