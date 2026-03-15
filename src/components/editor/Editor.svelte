<script lang="ts">
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
  import { editorStore } from "../../stores/editor.svelte";
  import { commandStore } from "../../stores/commands.svelte";
  import { focusContextStore } from "../../stores/focus-context.svelte";

  interface Props {
    content: string;
    path: string;
    onsave: (content: string) => void;
  }

  let { content, path, onsave }: Props = $props();

  let containerEl: HTMLDivElement | undefined = $state();

  // Plain variables — NOT $state. CodeMirror manages its own state.
  let view: EditorView | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // --- CodeMirror pure code (copied from React version) ---

  class HeadingWidget extends WidgetType {
    level: number;
    constructor(level: number) {
      super();
      this.level = level;
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

  const headingStyles: Record<
    number,
    { fontSize: string; fontWeight: string }
  > = {
    1: { fontSize: "24px", fontWeight: "700" },
    2: { fontSize: "20px", fontWeight: "600" },
    3: { fontSize: "16px", fontWeight: "600" },
    4: { fontSize: "14px", fontWeight: "600" },
    5: { fontSize: "13px", fontWeight: "600" },
    6: { fontSize: "13px", fontWeight: "500" },
  };

  function buildDecorations(v: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const cursor = v.state.selection.main.head;
    const cursorLine = v.state.doc.lineAt(cursor).number;

    syntaxTree(v.state).iterate({
      enter(node) {
        const line = v.state.doc.lineAt(node.from).number;
        if (line === cursorLine) return;

        switch (node.name) {
          case "ATXHeading1":
          case "ATXHeading2":
          case "ATXHeading3":
          case "ATXHeading4":
          case "ATXHeading5":
          case "ATXHeading6": {
            const level = parseInt(node.name.slice(-1));
            const headLine = v.state.doc.lineAt(node.from);
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
            const headerLine = v.state.doc.lineAt(node.from);
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
            const delimLine = v.state.doc.lineAt(node.from);
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
            const rowLine = v.state.doc.lineAt(node.from);
            builder.add(
              rowLine.from,
              rowLine.from,
              Decoration.line({
                attributes: {
                  style:
                    "border-bottom: 1px solid var(--color-border-default); padding-bottom: 1px;",
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
    (v) => ({
      decorations: buildDecorations(v),
      update(update) {
        if (update.docChanged || update.selectionSet) {
          this.decorations = buildDecorations(update.view);
        }
      },
    }),
    { decorations: (v) => v.decorations },
  );

  // --- Effect 1: View lifecycle (tracks path) ---
  $effect(() => {
    // Read path synchronously to track it
    const currentPath = path;

    if (!containerEl) return;

    // Closures always see current prop values in $effect
    const handleSave = (doc: string) => {
      onsave(doc);
      editorStore.markClean(currentPath);
    };

    const state = EditorState.create({
      doc: content,
      extensions: [
        markdown({ extensions: GFM }),
        livePreview,
        keymap.of([
          ...defaultKeymap,
          {
            key: "Mod-s",
            run: (v) => {
              handleSave(v.state.doc.toString());
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            editorStore.markDirty(currentPath);
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
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
            fontFamily:
              'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", monospace',
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

    const newView = new EditorView({
      state,
      parent: containerEl,
    });
    view = newView;

    commandStore.registerCommand({
      id: "document.save",
      label: "Save Document",
      shortcut: "Mod+S",
      context: "editor" as const,
      execute: () => {
        if (view) {
          const doc = view.state.doc.toString();
          handleSave(doc);
        }
      },
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
      newView.destroy();
      view = null;
      commandStore.unregisterCommand("document.save");
    };
  });

  // --- Effect 2: External content sync ---
  $effect(() => {
    // Read content synchronously to track it
    const currentContent = content;

    if (!view) return;

    const currentDoc = view.state.doc.toString();
    if (currentContent === currentDoc) return;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: currentContent },
    });
  });
</script>

<div
  bind:this={containerEl}
  class="editor-content flex-1 overflow-auto"
  onfocus={() => focusContextStore.setActiveRegion("editor")}
></div>
