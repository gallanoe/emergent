import { useEffect, useRef, useCallback } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap } from "@codemirror/commands";
import { useEditorStore } from "../stores/editor";

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

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        markdown(),
        keymap.of([
          ...defaultKeymap,
          {
            key: "Mod-s",
            run: (view) => {
              handleSave(view.state.doc.toString());
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            markDirty(path);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
              const doc = update.state.doc.toString();
              handleSave(doc);
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
    };
  }, [path, content, markDirty, handleSave]);

  return <div ref={containerRef} className="editor-content flex-1 overflow-auto" />;
}
