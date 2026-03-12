import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useWorkspaceStore } from "../../stores/workspace";
import { WorkspacePicker } from "../../components/WorkspacePicker";
import { openWorkspace, createWorkspace, deleteWorkspace } from "../../lib/tauri";

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

  describe("Task 4: inline new workspace creation", () => {
    it("shows input when clicking New workspace", () => {
      render(<WorkspacePicker />);
      fireEvent.click(screen.getByText("New workspace"));
      expect(screen.getByPlaceholderText("Workspace name...")).toBeDefined();
    });

    it("shows input on Cmd+N", () => {
      render(<WorkspacePicker />);
      fireEvent.keyDown(window, { key: "n", metaKey: true });
      expect(screen.getByPlaceholderText("Workspace name...")).toBeDefined();
    });

    it("hides input on Escape", () => {
      render(<WorkspacePicker />);
      fireEvent.click(screen.getByText("New workspace"));
      const input = screen.getByPlaceholderText("Workspace name...");
      expect(input).toBeDefined();

      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByPlaceholderText("Workspace name...")).toBeNull();
    });

    it("creates and opens workspace on Enter in input", async () => {
      vi.mocked(createWorkspace).mockResolvedValue("new-id");
      const mockMeta = {
        id: "new-id",
        name: "My Project",
        created_at: "2024-06-01T00:00:00Z",
        last_opened: "2024-06-01T00:00:00Z",
      };
      vi.mocked(openWorkspace).mockResolvedValue(mockMeta);

      render(<WorkspacePicker />);
      fireEvent.click(screen.getByText("New workspace"));
      const input = screen.getByPlaceholderText("Workspace name...");

      fireEvent.change(input, { target: { value: "My Project" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(createWorkspace).toHaveBeenCalledWith("My Project");
      });
      await waitFor(() => {
        expect(openWorkspace).toHaveBeenCalledWith("new-id");
      });
    });

    it("keeps input visible when createWorkspace fails", async () => {
      vi.mocked(createWorkspace).mockRejectedValue(new Error("duplicate name"));

      render(<WorkspacePicker />);
      fireEvent.click(screen.getByText("New workspace"));
      const input = screen.getByPlaceholderText("Workspace name...");

      fireEvent.change(input, { target: { value: "Existing" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(createWorkspace).toHaveBeenCalledWith("Existing");
      });
      // Input should still be visible (creatingNew stays true on error)
      expect(screen.getByPlaceholderText("Workspace name...")).toBeDefined();
    });
  });

  describe("Task 5: workspace deletion", () => {
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

    it("deletes workspace on Delete key after confirm", async () => {
      useWorkspaceStore.setState({
        workspaces: twoWorkspaces,
        activeWorkspace: null,
        currentBranch: "main",
        mergeState: null,
      });
      vi.spyOn(window, "confirm").mockReturnValue(true);
      vi.mocked(deleteWorkspace).mockResolvedValue(undefined);

      render(<WorkspacePicker />);

      // First selected item is Beta (sorted by last_opened desc)
      fireEvent.keyDown(window, { key: "Delete" });

      await waitFor(() => {
        expect(deleteWorkspace).toHaveBeenCalledWith("b");
      });
    });

    it("does not delete when confirm is cancelled", () => {
      useWorkspaceStore.setState({
        workspaces: twoWorkspaces,
        activeWorkspace: null,
        currentBranch: "main",
        mergeState: null,
      });
      vi.spyOn(window, "confirm").mockReturnValue(false);

      render(<WorkspacePicker />);

      fireEvent.keyDown(window, { key: "Delete" });

      expect(deleteWorkspace).not.toHaveBeenCalled();
    });

    it("deletes workspace on Backspace key after confirm", async () => {
      useWorkspaceStore.setState({
        workspaces: twoWorkspaces,
        activeWorkspace: null,
        currentBranch: "main",
        mergeState: null,
      });
      vi.spyOn(window, "confirm").mockReturnValue(true);
      vi.mocked(deleteWorkspace).mockResolvedValue(undefined);

      render(<WorkspacePicker />);

      fireEvent.keyDown(window, { key: "Backspace" });

      await waitFor(() => {
        expect(deleteWorkspace).toHaveBeenCalledWith("b");
      });
    });

    it("keeps workspace in list when deleteWorkspace fails", async () => {
      useWorkspaceStore.setState({
        workspaces: twoWorkspaces,
        activeWorkspace: null,
        currentBranch: "main",
        mergeState: null,
      });
      vi.spyOn(window, "confirm").mockReturnValue(true);
      vi.mocked(deleteWorkspace).mockRejectedValue(new Error("disk error"));

      render(<WorkspacePicker />);

      fireEvent.keyDown(window, { key: "Delete" });

      await waitFor(() => {
        expect(deleteWorkspace).toHaveBeenCalledWith("b");
      });
      // Workspace should still be in the list (not removed on failure)
      expect(screen.getByText("Beta")).toBeDefined();
    });
  });

  describe("Task 7: keyboard hints", () => {
    it("renders keyboard hints", () => {
      render(<WorkspacePicker />);
      expect(screen.getByText(/navigate/)).toBeDefined();
      expect(screen.getByText(/open/)).toBeDefined();
      expect(screen.getAllByText(/new/).length).toBeGreaterThan(0);
    });
  });

  describe("Task 6: click interaction", () => {
    it("selects workspace on click", () => {
      useWorkspaceStore.setState({
        workspaces: [
          {
            id: "a",
            name: "First",
            created_at: "2024-01-01T00:00:00Z",
            last_opened: "2024-06-01T00:00:00Z",
          },
          {
            id: "b",
            name: "Second",
            created_at: "2024-01-01T00:00:00Z",
            last_opened: "2024-01-01T00:00:00Z",
          },
        ],
        activeWorkspace: null,
        currentBranch: "main",
        mergeState: null,
      });
      render(<WorkspacePicker />);
      const items = screen.getAllByRole("option");
      fireEvent.click(items[1]!);
      expect(items[1]?.getAttribute("aria-selected")).toBe("true");
    });

    it("opens workspace on double-click", async () => {
      useWorkspaceStore.setState({
        workspaces: [
          {
            id: "ws-1",
            name: "Test",
            created_at: "2024-01-01T00:00:00Z",
            last_opened: "2024-06-01T00:00:00Z",
          },
        ],
        activeWorkspace: null,
        currentBranch: "main",
        mergeState: null,
      });
      vi.mocked(openWorkspace).mockResolvedValue({
        id: "ws-1",
        name: "Test",
        created_at: "2024-01-01T00:00:00Z",
        last_opened: "2024-06-01T00:00:00Z",
      });
      render(<WorkspacePicker />);
      const items = screen.getAllByRole("option");
      fireEvent.doubleClick(items[0]!);
      await waitFor(() => {
        expect(openWorkspace).toHaveBeenCalledWith("ws-1");
      });
    });
  });
});
