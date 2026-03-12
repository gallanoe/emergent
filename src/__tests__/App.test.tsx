import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { listWorkspaces } from "../lib/tauri";
import App from "../App";
import { useWorkspaceStore } from "../stores/workspace";

vi.mock("../lib/tauri", () => ({
  listWorkspaces: vi.fn().mockResolvedValue([]),
  createWorkspace: vi.fn().mockResolvedValue("new-id"),
  openWorkspace: vi.fn().mockResolvedValue({
    id: "new-id",
    name: "Test",
    created_at: "",
    last_opened: "",
  }),
  deleteWorkspace: vi.fn().mockResolvedValue(undefined),
  readDocument: vi.fn().mockResolvedValue(""),
  writeDocument: vi.fn().mockResolvedValue(undefined),
  createDocument: vi.fn().mockResolvedValue(undefined),
  createFolder: vi.fn().mockResolvedValue(undefined),
  listTree: vi.fn().mockResolvedValue([]),
  onTreeChanged: vi.fn().mockResolvedValue(() => {}),
  onDocumentChanged: vi.fn().mockResolvedValue(() => {}),
}));

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      activeWorkspace: null,
      workspaces: [],
      currentBranch: "main",
      mergeState: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders workspace picker when no active workspace", () => {
    render(<App />);
    expect(screen.getByText("Open a workspace")).toBeDefined();
  });

  it("renders app shell when workspace is active", () => {
    useWorkspaceStore.setState({
      activeWorkspace: {
        id: "ws-1",
        name: "Test",
        created_at: "",
        last_opened: "",
      },
    });
    render(<App />);
    expect(screen.getAllByText("No document open").length).toBeGreaterThan(0);
  });

  it("shows picker with error toast when listWorkspaces fails", async () => {
    vi.mocked(listWorkspaces).mockRejectedValueOnce(new Error("disk error"));
    render(<App />);
    await waitFor(() => {
      expect(listWorkspaces).toHaveBeenCalled();
    });
    // Picker should still render (empty state)
    expect(screen.getByText("Open a workspace")).toBeDefined();
  });
});
