import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Editor } from "../../components/Editor";
import { useCommandStore } from "../../stores/commands";
import { useFocusContextStore } from "../../stores/focus-context";

const createdViews: Array<{
  destroy: ReturnType<typeof vi.fn>;
  dispatch: ReturnType<typeof vi.fn>;
  state: { doc: { toString: () => string; length: number } };
}> = [];

vi.mock("@codemirror/view", () => {
  class MockEditorView {
    destroy = vi.fn();
    dispatch = vi.fn();
    state = { doc: { toString: () => "", length: 0 } };
    constructor(config?: { state?: { doc?: { toString: () => string; length: number } } }) {
      if (config?.state?.doc) {
        this.state = { doc: config.state.doc };
      }
      createdViews.push(this);
    }
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
    create: vi.fn().mockImplementation((config?: { doc?: string }) => {
      const docStr = config?.doc ?? "";
      return {
        doc: { toString: () => docStr, length: docStr.length },
      };
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
    createdViews.length = 0;
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

  describe("cursor preservation", () => {
    it("does not recreate the view when content prop changes", () => {
      const { rerender } = render(
        <Editor content="hello" path="test.md" onSave={vi.fn()} />,
      );
      expect(createdViews).toHaveLength(1);
      const firstView = createdViews[0]!;

      rerender(<Editor content="hello world" path="test.md" onSave={vi.fn()} />);

      // Same path — view should NOT be destroyed and recreated
      expect(createdViews).toHaveLength(1);
      expect(firstView.destroy).not.toHaveBeenCalled();
      // Content update dispatched as a transaction instead
      expect(firstView.dispatch).toHaveBeenCalledWith({
        changes: { from: 0, to: expect.any(Number), insert: "hello world" },
      });
    });

    it("recreates the view when path changes", () => {
      const { rerender } = render(
        <Editor content="hello" path="a.md" onSave={vi.fn()} />,
      );
      expect(createdViews).toHaveLength(1);
      const firstView = createdViews[0]!;

      rerender(<Editor content="other" path="b.md" onSave={vi.fn()} />);

      expect(firstView.destroy).toHaveBeenCalled();
      expect(createdViews).toHaveLength(2);
    });

    it("skips dispatch when content matches current doc", () => {
      const { rerender } = render(
        <Editor content="same" path="test.md" onSave={vi.fn()} />,
      );
      const view = createdViews[0]!;

      // Rerender with identical content
      rerender(<Editor content="same" path="test.md" onSave={vi.fn()} />);

      expect(view.dispatch).not.toHaveBeenCalled();
    });
  });
});
