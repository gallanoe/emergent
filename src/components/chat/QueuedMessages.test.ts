import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/svelte";
import { tick } from "svelte";
import QueuedMessages from "./QueuedMessages.svelte";
import type { QueueItem } from "../../stores/types";

afterEach(() => cleanup());

function makeItem(id: string, content: string, failed?: boolean): QueueItem {
  return {
    id,
    content,
    submittedAt: Date.now(),
    ...(failed !== undefined && { failed }),
  };
}

function defaultProps(
  items: QueueItem[],
  overrides?: Partial<{
    working: boolean;
    onRemove: (id: string) => void;
    onEdit: (id: string, content: string) => void;
    onClearAll: () => void;
  }>,
) {
  return {
    items,
    working: false,
    onRemove: vi.fn(),
    onEdit: vi.fn(),
    onClearAll: vi.fn(),
    ...overrides,
  };
}

// Helper: get the expandable row buttons (role="button" on the grid divs).
// We filter on aria-expanded presence and exclude the panel toggle region
// (which also has aria-expanded but is identified by aria-controls).
function getRowButtons() {
  return screen
    .getAllByRole("button")
    .filter((el) => el.hasAttribute("aria-expanded") && !el.hasAttribute("aria-controls"));
}

// Helper: get the panel toggle region identified by its unique aria-controls attribute.
function getToggleRegion(): HTMLElement {
  const el = document.querySelector('[aria-controls="queued-messages-list"]');
  if (!el) throw new Error("Toggle region not found");
  return el as HTMLElement;
}

describe("QueuedMessages", () => {
  describe("empty state", () => {
    it("renders nothing when items is empty", () => {
      const { container } = render(QueuedMessages, {
        props: defaultProps([]),
      });
      expect(container.querySelector('[aria-label="Queued messages"]')).toBeNull();
    });
  });

  describe("1 item", () => {
    it("renders exactly 1 row", () => {
      render(QueuedMessages, {
        props: defaultProps([makeItem("a", "first message")]),
      });
      expect(getRowButtons()).toHaveLength(1);
      expect(screen.getByText("first message")).toBeTruthy();
    });
  });

  describe("3 items — all visible, no fade", () => {
    it("renders 3 rows and no fade gradient", () => {
      const items = [makeItem("a", "msg-a"), makeItem("b", "msg-b"), makeItem("c", "msg-c")];
      const { container } = render(QueuedMessages, {
        props: defaultProps(items),
      });
      expect(getRowButtons()).toHaveLength(3);
      // No fade overlay when items.length === 3
      const fade = container.querySelector('[style*="linear-gradient"]');
      expect(fade).toBeNull();
    });
  });

  describe("5 items — scroll + fade gradient", () => {
    it("renders 5 rows and shows the bottom fade overlay", () => {
      const items = [
        makeItem("a", "msg-a"),
        makeItem("b", "msg-b"),
        makeItem("c", "msg-c"),
        makeItem("d", "msg-d"),
        makeItem("e", "msg-e"),
      ];
      const { container } = render(QueuedMessages, {
        props: defaultProps(items),
      });
      expect(getRowButtons()).toHaveLength(5);
      // Fade overlay present when items.length > 3
      const fade = container.querySelector('[style*="linear-gradient"]');
      expect(fade).not.toBeNull();
    });
  });

  describe("row expand/collapse", () => {
    it("clicking a row expands it (aria-expanded becomes true)", async () => {
      render(QueuedMessages, {
        props: defaultProps([makeItem("r1", "hello world"), makeItem("r2", "another")]),
      });
      const rows = getRowButtons();
      expect(rows[0]!.getAttribute("aria-expanded")).toBe("false");
      await fireEvent.click(rows[0]!);
      expect(rows[0]!.getAttribute("aria-expanded")).toBe("true");
    });

    it("clicking the same expanded row collapses it", async () => {
      render(QueuedMessages, {
        props: defaultProps([makeItem("r1", "hello world")]),
      });
      const rows = getRowButtons();
      const row = rows[0]!;
      await fireEvent.click(row);
      expect(row.getAttribute("aria-expanded")).toBe("true");
      await fireEvent.click(row);
      expect(row.getAttribute("aria-expanded")).toBe("false");
    });

    it("clicking a different row collapses the first and expands the second", async () => {
      render(QueuedMessages, {
        props: defaultProps([makeItem("r1", "first"), makeItem("r2", "second")]),
      });
      const rows = getRowButtons();
      await fireEvent.click(rows[0]!);
      expect(rows[0]!.getAttribute("aria-expanded")).toBe("true");
      expect(rows[1]!.getAttribute("aria-expanded")).toBe("false");
      await fireEvent.click(rows[1]!);
      expect(rows[0]!.getAttribute("aria-expanded")).toBe("false");
      expect(rows[1]!.getAttribute("aria-expanded")).toBe("true");
    });
  });

  describe("Edit button", () => {
    it("clicking Edit calls onEdit with (id, content) and does not toggle row expand", async () => {
      const onEdit = vi.fn();
      const item = makeItem("edit-1", "edit me");
      render(QueuedMessages, {
        props: defaultProps([item], { onEdit }),
      });
      const editBtn = screen.getByTitle("Edit — pull back into composer");
      const rows = getRowButtons();
      const row = rows[0]!;
      // Row starts collapsed
      expect(row.getAttribute("aria-expanded")).toBe("false");
      await fireEvent.click(editBtn);
      expect(onEdit).toHaveBeenCalledWith("edit-1", "edit me");
      // Row should NOT have been toggled (stopPropagation)
      expect(row.getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("Remove button", () => {
    it("clicking Remove calls onRemove with the item id", async () => {
      const onRemove = vi.fn();
      render(QueuedMessages, {
        props: defaultProps([makeItem("rm-1", "remove me"), makeItem("rm-2", "keep me")], {
          onRemove,
        }),
      });
      const removeBtns = screen.getAllByTitle("Remove from queue");
      await fireEvent.click(removeBtns[0]!);
      expect(onRemove).toHaveBeenCalledWith("rm-1");
    });

    it("does not toggle row expand when Remove is clicked", async () => {
      const onRemove = vi.fn();
      const item = makeItem("rm-x", "test");
      render(QueuedMessages, {
        props: defaultProps([item], { onRemove }),
      });
      const rows = getRowButtons();
      const row = rows[0]!;
      const removeBtn = screen.getByTitle("Remove from queue");
      await fireEvent.click(removeBtn);
      // stopPropagation — row should not have expanded
      expect(row.getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("Clear all button", () => {
    it("clicking Clear all calls onClearAll", async () => {
      const onClearAll = vi.fn();
      render(QueuedMessages, {
        props: defaultProps([makeItem("a", "item a")], { onClearAll }),
      });
      const clearBtn = screen.getByTitle("Clear queue");
      await fireEvent.click(clearBtn);
      expect(onClearAll).toHaveBeenCalledOnce();
    });
  });

  describe("failed item styling", () => {
    it("renders a failed item with error color on the index", () => {
      const { container } = render(QueuedMessages, {
        props: defaultProps([makeItem("fail-1", "failed message", true)]),
      });
      // The index span carries text-error when failed
      const indexSpan = container.querySelector("span.text-error");
      expect(indexSpan).not.toBeNull();
    });

    it("does not apply error index styling on a normal item", () => {
      const { container } = render(QueuedMessages, {
        props: defaultProps([makeItem("ok-1", "normal message")]),
      });
      const indexSpan = container.querySelector("span.text-error");
      expect(indexSpan).toBeNull();
    });

    it("aria-label mentions 'failed' for a failed item", () => {
      render(QueuedMessages, {
        props: defaultProps([makeItem("fail-2", "error item", true)]),
      });
      const rows = getRowButtons();
      expect(rows[0]!.getAttribute("aria-label")).toContain("failed");
    });
  });

  describe("working auto-expand $effect", () => {
    it("does not expand any row when working is false", () => {
      render(QueuedMessages, {
        props: defaultProps([makeItem("w1", "first"), makeItem("w2", "second")], {
          working: false,
        }),
      });
      const rows = getRowButtons();
      expect(rows[0]!.getAttribute("aria-expanded")).toBe("false");
      expect(rows[1]!.getAttribute("aria-expanded")).toBe("false");
    });

    it("auto-expands the first item when working becomes true", async () => {
      const { rerender } = render(QueuedMessages, {
        props: defaultProps([makeItem("w1", "first"), makeItem("w2", "second")], {
          working: false,
        }),
      });
      // Confirm none expanded initially
      let rows = getRowButtons();
      expect(rows[0]!.getAttribute("aria-expanded")).toBe("false");

      await rerender({
        items: [makeItem("w1", "first"), makeItem("w2", "second")],
        working: true,
        onRemove: vi.fn(),
        onEdit: vi.fn(),
        onClearAll: vi.fn(),
      });
      await tick();

      rows = getRowButtons();
      expect(rows[0]!.getAttribute("aria-expanded")).toBe("true");
      // Second row should still be collapsed
      expect(rows[1]!.getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("header", () => {
    it("shows count in header", () => {
      render(QueuedMessages, {
        props: defaultProps([makeItem("a", "x"), makeItem("b", "y")]),
      });
      // "Queued · 2" text
      expect(screen.getByText(/queued\s*·\s*2/i)).toBeTruthy();
    });

    it("shows 'sends after current turn' hint when working", () => {
      render(QueuedMessages, {
        props: defaultProps([makeItem("a", "x")], { working: true }),
      });
      expect(screen.getByText("sends after current turn")).toBeTruthy();
    });

    it("hides the working hint when not working", () => {
      render(QueuedMessages, {
        props: defaultProps([makeItem("a", "x")], { working: false }),
      });
      expect(screen.queryByText("sends after current turn")).toBeNull();
    });
  });

  describe("panel collapse/expand toggle", () => {
    it("rows are visible by default (expanded === true)", () => {
      render(QueuedMessages, {
        props: defaultProps([makeItem("p1", "panel test")]),
      });
      expect(screen.getByText("panel test")).toBeTruthy();
    });

    it("toggle region has aria-expanded=true initially", () => {
      render(QueuedMessages, {
        props: defaultProps([makeItem("p1", "panel test")]),
      });
      const toggle = getToggleRegion();
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
    });

    it("clicking the toggle hides rows but keeps header visible", async () => {
      render(QueuedMessages, {
        props: defaultProps([makeItem("p2", "hide me")]),
      });
      const toggle = getToggleRegion();
      await fireEvent.click(toggle);
      // Row content should be gone
      expect(screen.queryByText("hide me")).toBeNull();
      // Header count label still present
      expect(screen.getByText(/queued\s*·\s*1/i)).toBeTruthy();
    });

    it("clicking the toggle again re-shows rows", async () => {
      render(QueuedMessages, {
        props: defaultProps([makeItem("p3", "show me again")]),
      });
      const toggle = getToggleRegion();
      await fireEvent.click(toggle);
      expect(screen.queryByText("show me again")).toBeNull();
      await fireEvent.click(toggle);
      expect(screen.getByText("show me again")).toBeTruthy();
    });

    it("toggle aria-expanded reflects collapsed state", async () => {
      render(QueuedMessages, {
        props: defaultProps([makeItem("p4", "aria test")]),
      });
      const toggle = getToggleRegion();
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      await fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
    });

    it("toggle has aria-controls pointing to the list element id", () => {
      const { container } = render(QueuedMessages, {
        props: defaultProps([makeItem("p5", "controls test")]),
      });
      const toggle = getToggleRegion();
      expect(toggle.getAttribute("aria-controls")).toBe("queued-messages-list");
      expect(container.querySelector("#queued-messages-list")).not.toBeNull();
    });

    it("Clear all fires onClearAll while panel is collapsed", async () => {
      const onClearAll = vi.fn();
      render(QueuedMessages, {
        props: defaultProps([makeItem("p6", "clear while collapsed")], { onClearAll }),
      });
      // Collapse first
      const toggle = getToggleRegion();
      await fireEvent.click(toggle);
      // Clear all should still be visible and functional
      const clearBtn = screen.getByTitle("Clear queue");
      await fireEvent.click(clearBtn);
      expect(onClearAll).toHaveBeenCalledOnce();
      // Collapsed state should be unchanged (still collapsed)
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
    });

    it("fade gradient is not rendered when panel is collapsed", async () => {
      const items = [
        makeItem("a", "msg-a"),
        makeItem("b", "msg-b"),
        makeItem("c", "msg-c"),
        makeItem("d", "msg-d"),
      ];
      const { container } = render(QueuedMessages, {
        props: defaultProps(items),
      });
      // Confirm fade is visible when expanded
      expect(container.querySelector('[style*="linear-gradient"]')).not.toBeNull();
      // Collapse
      const toggle = getToggleRegion();
      await fireEvent.click(toggle);
      // Fade should be gone
      expect(container.querySelector('[style*="linear-gradient"]')).toBeNull();
    });
  });
});
