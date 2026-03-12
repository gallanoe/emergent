import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Editor } from "../../components/Editor";
import { useCommandStore } from "../../stores/commands";
import { useFocusContextStore } from "../../stores/focus-context";

vi.mock("@codemirror/view", () => {
  const mockViewInstance = {
    destroy: vi.fn(),
    state: { doc: { toString: () => "" } },
    dispatch: vi.fn(),
  };
  class MockEditorView {
    destroy = mockViewInstance.destroy;
    state = mockViewInstance.state;
    dispatch = mockViewInstance.dispatch;
    static updateListener = { of: vi.fn().mockReturnValue([]) };
    static theme = vi.fn().mockReturnValue([]);
  }
  return {
    EditorView: MockEditorView,
    keymap: { of: vi.fn().mockReturnValue([]) },
    ViewPlugin: {
      define: vi.fn().mockReturnValue([]),
      fromClass: vi.fn().mockReturnValue([]),
    },
    Decoration: {
      replace: vi.fn().mockReturnValue({}),
      set: vi.fn().mockReturnValue({}),
      mark: vi.fn().mockReturnValue({}),
    },
    WidgetType: class {},
  };
});
vi.mock("@codemirror/state", () => ({
  EditorState: {
    create: vi.fn().mockReturnValue({
      doc: { toString: () => "" },
    }),
  },
  RangeSetBuilder: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
    finish: vi.fn().mockReturnValue({}),
  })),
}));
vi.mock("@codemirror/commands", () => ({
  defaultKeymap: [],
}));
vi.mock("@codemirror/lang-markdown", () => ({
  markdown: vi.fn().mockReturnValue([]),
}));
vi.mock("@codemirror/language", () => ({
  syntaxTree: vi.fn().mockReturnValue({
    iterate: vi.fn(),
  }),
}));

describe("Editor", () => {
  beforeEach(() => {
    useCommandStore.setState({ commands: new Map(), paletteOpen: false });
    useFocusContextStore.setState({ activeRegion: "global" });
  });

  afterEach(() => {
    cleanup();
  });

  describe("command registration", () => {
    it("registers document.save command on mount", () => {
      render(<Editor content="test" path="test.md" onSave={vi.fn()} />);
      const cmd = useCommandStore.getState().commands.get("document.save");
      expect(cmd).toBeDefined();
      expect(cmd!.label).toBe("Save Document");
      expect(cmd!.shortcut).toBe("Mod+S");
      expect(cmd!.context).toBe("editor");
    });

    it("unregisters document.save on unmount", () => {
      const { unmount } = render(<Editor content="test" path="test.md" onSave={vi.fn()} />);
      expect(useCommandStore.getState().commands.has("document.save")).toBe(true);
      unmount();
      expect(useCommandStore.getState().commands.has("document.save")).toBe(false);
    });
  });
});
