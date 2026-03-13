import { useEffect, useRef, useCallback } from "react";
import {
  EditorView,
  keymap,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  WidgetType,
} from "@codemirror/view";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import { useEditorStore } from "../stores/editor";
import { useCommandStore } from "../stores/commands";
import { useFocusContextStore } from "../stores/focus-context";

class HeadingWidget extends WidgetType {
  constructor(readonly level: number) {
    super();
  }
  toDOM() {
    const span = document.createElement("span");
    span.style.color = "var(--color-fg-disabled)";
    span.style.fontSize = "10px";
    span.style.marginRight = "4px";
    span.textContent = `H${this.level}`;
    return span;
  }
}

const headingStyles: Record<number, { fontSize: string; fontWeight: string }> = {
  1: { fontSize: "24px", fontWeight: "700" },
  2: { fontSize: "20px", fontWeight: "600" },
  3: { fontSize: "16px", fontWeight: "600" },
  4: { fontSize: "14px", fontWeight: "600" },
  5: { fontSize: "13px", fontWeight: "600" },
  6: { fontSize: "13px", fontWeight: "500" },
};

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const cursor = view.state.selection.main.head;
  const cursorLine = view.state.doc.lineAt(cursor).number;

  syntaxTree(view.state).iterate({
    enter(node) {
      const line = view.state.doc.lineAt(node.from).number;
      if (line === cursorLine) return;

      switch (node.name) {
        case "ATXHeading1":
        case "ATXHeading2":
        case "ATXHeading3":
        case "ATXHeading4":
        case "ATXHeading5":
        case "ATXHeading6": {
          const level = parseInt(node.name.slice(-1));
          const headLine = view.state.doc.lineAt(node.from);
          const hashEnd = headLine.text.indexOf(" ") + 1;
          if (hashEnd > 0) {
            builder.add(
              headLine.from,
              headLine.from + hashEnd,
              Decoration.replace({
                widget: new HeadingWidget(level),
              }),
            );
            const style = headingStyles[level] ?? headingStyles[6]!;
            builder.add(
              headLine.from + hashEnd,
              headLine.to,
              Decoration.mark({
                attributes: {
                  style: `font-size: ${style.fontSize}; font-weight: ${style.fontWeight}; color: var(--color-fg-heading);`,
                },
              }),
            );
          }
          break;
        }
        case "Emphasis": {
          builder.add(node.from, node.from + 1, Decoration.replace({}));
          builder.add(
            node.from + 1,
            node.to - 1,
            Decoration.mark({
              attributes: { style: "font-style: italic;" },
            }),
          );
          builder.add(node.to - 1, node.to, Decoration.replace({}));
          break;
        }
        case "StrongEmphasis": {
          builder.add(node.from, node.from + 2, Decoration.replace({}));
          builder.add(
            node.from + 2,
            node.to - 2,
            Decoration.mark({
              attributes: {
                style: "font-weight: 600; color: var(--color-fg-heading);",
              },
            }),
          );
          builder.add(node.to - 2, node.to, Decoration.replace({}));
          break;
        }
        case "InlineCode": {
          builder.add(node.from, node.from + 1, Decoration.replace({}));
          builder.add(
            node.from + 1,
            node.to - 1,
            Decoration.mark({
              attributes: {
                style:
                  "background: var(--color-bg-hover); padding: 1px 4px; border-radius: 3px; font-size: 12px;",
              },
            }),
          );
          builder.add(node.to - 1, node.to, Decoration.replace({}));
          break;
        }
        case "TableHeader": {
          const headerLine = view.state.doc.lineAt(node.from);
          builder.add(
            headerLine.from,
            headerLine.from,
            Decoration.line({
              attributes: {
                style: "font-weight: 600; color: var(--color-fg-heading);",
              },
            }),
          );
          break;
        }
        case "TableDelimiter": {
          const delimLine = view.state.doc.lineAt(node.from);
          builder.add(
            delimLine.from,
            delimLine.from,
            Decoration.line({
              attributes: {
                style: "color: var(--color-fg-disabled); font-size: 11px;",
              },
            }),
          );
          break;
        }
        case "TableRow": {
          const rowLine = view.state.doc.lineAt(node.from);
          builder.add(
            rowLine.from,
            rowLine.from,
            Decoration.line({
              attributes: {
                style: "border-bottom: 1px solid var(--color-border-default); padding-bottom: 1px;",
              },
            }),
          );
          break;
        }
      }
    },
  });

  return builder.finish();
}

const livePreview = ViewPlugin.define(
  (view) => ({
    decorations: buildDecorations(view),
    update(update) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view);
      }
    },
  }),
  { decorations: (v) => v.decorations },
);

type EditorProps = {
  content: string;
  path: string;
  onSave: (content: string) => void;
};

export function Editor({ content, path, onSave }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markDirty = useEditorStore((s) => s.markDirty);
  const markClean = useEditorStore((s) => s.markClean);

  const handleSave = useCallback(
    (content: string) => {
      onSave(content);
      markClean(path);
    },
    [onSave, markClean, path],
  );

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const markDirtyRef = useRef(markDirty);
  markDirtyRef.current = markDirty;

  useEffect(() => {
    useCommandStore.getState().registerCommand({
      id: "document.save",
      label: "Save Document",
      shortcut: "Mod+S",
      context: "editor" as const,
      execute: () => {
        if (viewRef.current) {
          const content = viewRef.current.state.doc.toString();
          handleSaveRef.current(content);
        }
      },
    });
    return () => useCommandStore.getState().unregisterCommand("document.save");
  }, []);

  // Effect 1 — View lifecycle (keyed on path)
  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        markdown({ extensions: GFM }),
        livePreview,
        keymap.of([
          ...defaultKeymap,
          {
            key: "Mod-s",
            run: (view) => {
              handleSaveRef.current(view.state.doc.toString());
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            markDirtyRef.current(path);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
              const doc = update.state.doc.toString();
              handleSaveRef.current(doc);
            }, 1000);
          }
        }),
        EditorView.theme({
          "&": {
            backgroundColor: "var(--color-bg-base)",
            color: "var(--color-fg-default)",
            fontSize: "13px",
            fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", monospace',
          },
          ".cm-content": {
            caretColor: "var(--color-accent)",
            lineHeight: "1.6",
            padding: "16px 0",
          },
          ".cm-cursor": {
            borderLeftColor: "var(--color-accent)",
          },
          ".cm-selectionBackground": {
            backgroundColor: "var(--color-bg-selected) !important",
          },
          ".cm-gutters": {
            backgroundColor: "var(--color-bg-base)",
            color: "var(--color-fg-disabled)",
            border: "none",
          },
          ".cm-activeLine": {
            backgroundColor: "transparent",
          },
          ".cm-activeLineGutter": {
            backgroundColor: "transparent",
          },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      view.destroy();
      viewRef.current = null;
    };
    // content intentionally excluded — only used for initial doc
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Effect 2 — External content sync (soft update via transaction)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentDoc = view.state.doc.toString();
    if (content === currentDoc) return;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
  }, [content]);

  return (
    <div
      ref={containerRef}
      className="editor-content flex-1 overflow-auto"
      onFocus={() => useFocusContextStore.getState().setActiveRegion("editor")}
    />
  );
}
