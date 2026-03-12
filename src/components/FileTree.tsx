import { useCallback, useEffect, useRef, useState } from "react";
import { useFileTreeStore } from "../stores/file-tree";
import { useEditorStore } from "../stores/editor";
import { useCommandStore } from "../stores/commands";
import { useFocusContextStore } from "../stores/focus-context";
import type { TreeNode } from "../lib/tauri";
import {
  moveDocument,
  moveFolder,
  createDocument,
  createFolder,
  readDocument,
  deleteDocument,
  deleteFolder,
  writeDocument,
} from "../lib/tauri";
import { sortTree } from "../lib/sort-tree";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { useToastStore } from "./Toast";

const INDENT = 16;
const ITEM_HEIGHT = 28;

function findNode(tree: TreeNode[], path: string): TreeNode | null {
  for (const node of tree) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function updateChildPaths(
  children: TreeNode[],
  oldParentPath: string,
  newParentPath: string,
): TreeNode[] {
  return children.map((child) => {
    const childNewPath = newParentPath + child.path.substring(oldParentPath.length);
    const copy: TreeNode = { name: child.name, path: childNewPath, kind: child.kind };
    if (child.children)
      copy.children = updateChildPaths(child.children, oldParentPath, newParentPath);
    return copy;
  });
}

function renameNodeInTree(
  tree: TreeNode[],
  oldPath: string,
  newName: string,
  newPath: string,
): TreeNode[] {
  return tree.map((node) => {
    if (node.path === oldPath) {
      const copy: TreeNode = { name: newName, path: newPath, kind: node.kind };
      if (node.children) copy.children = updateChildPaths(node.children, oldPath, newPath);
      return copy;
    }
    if (node.children) {
      const copy: TreeNode = { name: node.name, path: node.path, kind: node.kind };
      copy.children = renameNodeInTree(node.children, oldPath, newName, newPath);
      return copy;
    }
    return node;
  });
}

function removeNodeFromTree(tree: TreeNode[], path: string): TreeNode[] {
  return tree
    .filter((node) => node.path !== path)
    .map((node) => {
      if (!node.children) return node;
      const copy: TreeNode = { name: node.name, path: node.path, kind: node.kind };
      copy.children = removeNodeFromTree(node.children, path);
      return copy;
    });
}

function insertNodeInTree(tree: TreeNode[], parentPath: string, node: TreeNode): TreeNode[] {
  if (!parentPath) {
    return [...tree, node];
  }
  return tree.map((n) => {
    if (n.path === parentPath && n.kind === "folder") {
      const copy: TreeNode = { name: n.name, path: n.path, kind: n.kind };
      copy.children = [...(n.children ?? []), node];
      return copy;
    }
    if (n.children) {
      const copy: TreeNode = { name: n.name, path: n.path, kind: n.kind };
      copy.children = insertNodeInTree(n.children, parentPath, node);
      return copy;
    }
    return n;
  });
}

function countFilesInSubtree(node: TreeNode): number {
  if (node.kind === "file") return 1;
  if (!node.children) return 0;
  return node.children.reduce((sum, child) => sum + countFilesInSubtree(child), 0);
}

async function stashFolderContents(node: TreeNode): Promise<Map<string, string>> {
  const stash = new Map<string, string>();
  const collect = async (n: TreeNode) => {
    if (n.kind === "file") {
      const content = await readDocument(n.path);
      stash.set(n.path, content);
    } else if (n.children) {
      for (const child of n.children) {
        await collect(child);
      }
    }
  };
  if (node.children) {
    for (const child of node.children) {
      await collect(child);
    }
  }
  return stash;
}

function RenameInput({
  defaultValue,
  isFile,
  onConfirm,
  onCancel,
}: {
  defaultValue: string;
  isFile: boolean;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmedRef = useRef(false);

  const doConfirm = useCallback(
    (value: string) => {
      if (confirmedRef.current) return;
      confirmedRef.current = true;
      onConfirm(value);
    },
    [onConfirm],
  );

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (isFile) {
      const dotIdx = defaultValue.lastIndexOf(".");
      if (dotIdx > 0) {
        el.setSelectionRange(0, dotIdx);
      } else {
        el.select();
      }
    } else {
      el.select();
    }
  }, [defaultValue, isFile]);

  return (
    <input
      ref={inputRef}
      defaultValue={defaultValue}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          doConfirm(e.currentTarget.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          confirmedRef.current = true;
          onCancel();
        }
      }}
      onBlur={(e) => {
        doConfirm(e.currentTarget.value);
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        background: "var(--color-bg-base)",
        border: "1px solid var(--color-accent)",
        borderRadius: 4,
        fontSize: 13,
        color: "var(--color-fg-default)",
        padding: "0 4px",
        outline: "none",
        width: "100%",
        height: 20,
      }}
    />
  );
}

function CreationInput({
  kind,
  depth,
  onConfirm,
  onCancel,
}: {
  kind: "file" | "folder";
  depth: number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const confirmedRef = useRef(false);

  const doConfirm = useCallback(
    (value: string) => {
      if (confirmedRef.current) return;
      confirmedRef.current = true;
      const name = value.trim();
      if (name) onConfirm(name);
      else onCancel();
    },
    [onConfirm, onCancel],
  );

  return (
    <div
      style={{
        height: 28,
        display: "flex",
        alignItems: "center",
        paddingLeft: depth * 16 + 8,
        borderLeft: "2px solid var(--color-accent)",
      }}
    >
      <input
        autoFocus
        placeholder={kind === "file" ? "untitled.md" : "New folder"}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            doConfirm(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            confirmedRef.current = true;
            onCancel();
          }
        }}
        onBlur={(e) => {
          doConfirm(e.currentTarget.value);
        }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-bg-base)",
          border: "1px solid var(--color-accent)",
          borderRadius: 4,
          fontSize: 13,
          color: "var(--color-fg-default)",
          padding: "0 4px",
          outline: "none",
          width: "100%",
          height: 20,
        }}
      />
    </div>
  );
}

function FileTreeNode({
  node,
  depth,
  onContextMenu,
  renamingPath,
  onRenameConfirm,
  onRenameCancel,
  onRenameStart,
  onSelect,
  creating,
  onCreateConfirm,
  onCreateCancel,
  dragging,
  dropTarget,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  node: TreeNode;
  depth: number;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  renamingPath: string | null;
  onRenameConfirm: (newName: string) => void;
  onRenameCancel: () => void;
  onRenameStart: (path: string) => void;
  onSelect: (path: string) => void;
  creating: { parentPath: string; type: "file" | "folder" } | null;
  onCreateConfirm: (name: string) => void;
  onCreateCancel: () => void;
  dragging: string | null;
  dropTarget: string | null;
  onDragStart: (node: TreeNode) => void;
  onDragOver: (node: TreeNode) => void;
  onDragLeave: () => void;
  onDrop: (sourcePath: string, targetNode: TreeNode) => void;
}) {
  const { expandedPaths, selectedPath, toggleExpanded } = useFileTreeStore();
  const openTab = useEditorStore((s) => s.openTab);
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const isFolder = node.kind === "folder";
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(() => {
    if (isSelected) {
      // Already selected: do nothing on single click (no delayed rename)
      // But still need to handle folder toggle / file open for non-rename scenarios
      return;
    }
    // Not selected: select immediately and open/toggle
    onSelect(node.path);
    if (isFolder) {
      toggleExpanded(node.path);
    } else {
      openTab(node.path);
    }
  }, [node.path, isFolder, isSelected, onSelect, toggleExpanded, openTab]);

  const handleDoubleClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (isSelected) {
      onRenameStart(node.path);
    } else {
      onSelect(node.path);
      if (isFolder) {
        toggleExpanded(node.path);
      } else {
        openTab(node.path);
      }
    }
  }, [node.path, isFolder, isSelected, onSelect, onRenameStart, toggleExpanded, openTab]);

  return (
    <>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", node.path);
          e.dataTransfer.effectAllowed = "move";
          onDragStart(node);
        }}
        onDragEnd={() => {
          onDragLeave();
        }}
        onDragOver={(e) => {
          if (node.kind === "folder") {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            onDragOver(node);
          }
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          onDragLeave();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const sourcePath = e.dataTransfer.getData("text/plain");
          onDrop(sourcePath, node);
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => onContextMenu(e, node)}
        className="flex cursor-default items-center px-2"
        style={{
          height: ITEM_HEIGHT,
          paddingLeft: depth * INDENT + 8,
          fontSize: 13,
          opacity: dragging === node.path ? 0.5 : 1,
          color: isSelected ? "var(--color-fg-heading)" : "var(--color-fg-default)",
          background:
            dropTarget === node.path && node.kind === "folder"
              ? "var(--color-bg-selected)"
              : isSelected
                ? "var(--color-bg-hover)"
                : "transparent",
          borderLeft: isSelected ? "2px solid var(--color-accent)" : "2px solid transparent",
          transition: "background 100ms ease-out",
        }}
        onMouseEnter={(e) => {
          if (!isSelected && dropTarget !== node.path) {
            e.currentTarget.style.background = "var(--color-bg-hover)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isSelected && dropTarget !== node.path) {
            e.currentTarget.style.background = "transparent";
          }
        }}
      >
        {isFolder && (
          <span
            style={{
              fontSize: 10,
              color: "var(--color-fg-muted)",
              marginRight: 6,
              display: "inline-block",
              transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 100ms ease-out",
            }}
          >
            ▶
          </span>
        )}
        {renamingPath === node.path ? (
          <RenameInput
            defaultValue={node.name}
            isFile={node.kind === "file"}
            onConfirm={onRenameConfirm}
            onCancel={onRenameCancel}
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
      </div>
      {isFolder && isExpanded && node.children && (
        <>
          {creating?.parentPath === node.path && (
            <CreationInput
              kind={creating.type}
              depth={depth + 1}
              onConfirm={onCreateConfirm}
              onCancel={onCreateCancel}
            />
          )}
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              onRenameConfirm={onRenameConfirm}
              onRenameCancel={onRenameCancel}
              onRenameStart={onRenameStart}
              onSelect={onSelect}
              creating={creating}
              onCreateConfirm={onCreateConfirm}
              onCreateCancel={onCreateCancel}
              dragging={dragging}
              dropTarget={dropTarget}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            />
          ))}
        </>
      )}
    </>
  );
}

export function FileTree() {
  const tree = useFileTreeStore((s) => s.tree);
  const { selectedPath, expandedPaths, toggleExpanded, setSelected } = useFileTreeStore();
  const openTab = useEditorStore((s) => s.openTab);
  const treeRef = useRef<HTMLDivElement>(null);
  const renamingPath = useFileTreeStore((s) => s.pendingRename);
  const creating = useFileTreeStore((s) => s.pendingCreation);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: TreeNode | null;
  } | null>(null);

  const getMenuItems = useCallback((target: TreeNode | null): MenuItem[] => {
    if (target === null) {
      return [
        { label: "New File", action: "new-file" },
        { label: "New Folder", action: "new-folder" },
      ];
    }
    if (target.kind === "folder") {
      return [
        { label: "New File", action: "new-file" },
        { label: "New Folder", action: "new-folder" },
        { type: "separator" },
        { label: "Rename", action: "rename" },
        { label: "Delete", action: "delete" },
      ];
    }
    return [
      { label: "Rename", action: "rename" },
      { label: "Delete", action: "delete" },
    ];
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, target: TreeNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, target });
  }, []);

  const handleDrop = useCallback(async (sourcePath: string, targetNode: TreeNode | null) => {
    setDragging(null);
    setDropTarget(null);

    const currentTree = useFileTreeStore.getState().tree;
    const sourceNode = findNode(currentTree, sourcePath);
    if (!sourceNode) return;

    const targetPath = targetNode?.path ?? "";
    if (sourcePath === targetPath) return;

    const sourceParent = sourcePath.includes("/")
      ? sourcePath.substring(0, sourcePath.lastIndexOf("/"))
      : "";
    if (sourceParent === targetPath) return;

    if (targetPath.startsWith(sourcePath + "/")) return;

    const newPath = targetPath ? `${targetPath}/${sourceNode.name}` : sourceNode.name;

    const snapshot = useFileTreeStore.getState().snapshotTree();

    // Optimistic move
    const treeWithout = removeNodeFromTree(currentTree, sourcePath);
    const movedNode: TreeNode = {
      name: sourceNode.name,
      path: newPath,
      kind: sourceNode.kind,
    };
    if (sourceNode.children) movedNode.children = sourceNode.children;
    const treeWith = insertNodeInTree(treeWithout, targetPath, movedNode);
    useFileTreeStore.getState().setTree(sortTree(treeWith));
    useEditorStore.getState().updateTabPath(sourcePath, newPath);

    try {
      const moveFn = sourceNode.kind === "folder" ? moveFolder : moveDocument;
      await moveFn(sourcePath, newPath);
    } catch (err) {
      useFileTreeStore.getState().rollbackTree(snapshot);
      useToastStore
        .getState()
        .addToast(`Move failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, []);

  const handleDelete = useCallback(async (node: TreeNode) => {
    // Size guard: folders with >50 files get a confirmation toast
    if (node.kind === "folder") {
      const fileCount = countFilesInSubtree(node);
      if (fileCount > 50) {
        useToastStore.getState().addToast(
          `Delete ${node.name} (${fileCount} files)?`,
          "info",
          {
            label: "Confirm",
            onClick: async () => {
              const snapshot = useFileTreeStore.getState().snapshotTree();
              useFileTreeStore
                .getState()
                .setTree(removeNodeFromTree(useFileTreeStore.getState().tree, node.path));
              const { openTabs, closeTab } = useEditorStore.getState();
              for (const tab of openTabs) {
                if (tab.path === node.path || tab.path.startsWith(node.path + "/")) {
                  closeTab(tab.path);
                }
              }
              try {
                await deleteFolder(node.path);
              } catch (err) {
                useFileTreeStore.getState().rollbackTree(snapshot);
                useToastStore
                  .getState()
                  .addToast(
                    `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
                    "error",
                  );
              }
            },
          },
          5000,
        );
        return;
      }
    }

    // Stash content for undo
    try {
      let stash: Map<string, string>;
      if (node.kind === "file") {
        const content = await readDocument(node.path);
        stash = new Map([[node.path, content]]);
      } else {
        stash = await stashFolderContents(node);
      }

      const snapshot = useFileTreeStore.getState().snapshotTree();

      // Optimistic removal
      useFileTreeStore
        .getState()
        .setTree(removeNodeFromTree(useFileTreeStore.getState().tree, node.path));

      // Close affected tabs
      const { openTabs, closeTab } = useEditorStore.getState();
      for (const tab of openTabs) {
        if (tab.path === node.path || tab.path.startsWith(node.path + "/")) {
          closeTab(tab.path);
        }
      }

      // Call backend
      try {
        if (node.kind === "file") {
          await deleteDocument(node.path);
        } else {
          await deleteFolder(node.path);
        }
      } catch (err) {
        useFileTreeStore.getState().rollbackTree(snapshot);
        useToastStore
          .getState()
          .addToast(`Delete failed: ${err instanceof Error ? err.message : String(err)}`, "error");
        return;
      }

      // Show undo toast
      useToastStore.getState().addToast(
        `Deleted ${node.name}`,
        "info",
        {
          label: "Undo",
          onClick: async () => {
            try {
              if (node.kind === "file") {
                await createDocument(node.path);
                const content = stash.get(node.path) ?? "";
                await writeDocument(node.path, content);
              } else {
                await createFolder(node.path);
                for (const [path, content] of stash) {
                  await createDocument(path);
                  await writeDocument(path, content);
                }
              }
            } catch (err) {
              useToastStore
                .getState()
                .addToast(
                  `Undo failed: ${err instanceof Error ? err.message : String(err)}`,
                  "error",
                );
            }
          },
        },
        5000,
      );
    } catch (err) {
      useToastStore
        .getState()
        .addToast(`Delete failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, []);

  const handleContextAction = useCallback(
    (action: string) => {
      const target = contextMenu?.target;
      setContextMenu(null);
      switch (action) {
        case "rename": {
          if (target) useFileTreeStore.getState().setPendingRename(target.path);
          break;
        }
        case "new-file": {
          const parentPath = target?.kind === "folder" ? target.path : "";
          if (target?.kind === "folder" && !expandedPaths.has(target.path)) {
            toggleExpanded(target.path);
          }
          useFileTreeStore.getState().setPendingCreation({ type: "file", parentPath });
          break;
        }
        case "new-folder": {
          const parentPath = target?.kind === "folder" ? target.path : "";
          if (target?.kind === "folder" && !expandedPaths.has(target.path)) {
            toggleExpanded(target.path);
          }
          useFileTreeStore.getState().setPendingCreation({ type: "folder", parentPath });
          break;
        }
        case "delete": {
          if (target) handleDelete(target);
          break;
        }
      }
    },
    [contextMenu, expandedPaths, toggleExpanded, handleDelete],
  );

  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      if (!renamingPath) return;
      const node = findNode(tree, renamingPath);
      if (!node || !newName.trim() || newName === node.name) {
        useFileTreeStore.getState().clearPendingRename();
        return;
      }
      const parentPath = renamingPath.includes("/")
        ? renamingPath.substring(0, renamingPath.lastIndexOf("/"))
        : "";
      const newPath = parentPath ? `${parentPath}/${newName}` : newName;
      const snapshot = useFileTreeStore.getState().snapshotTree();

      // Optimistic update
      useFileTreeStore.getState().setTree(renameNodeInTree(tree, renamingPath, newName, newPath));
      useEditorStore.getState().updateTabPath(renamingPath, newPath);
      useFileTreeStore.getState().clearPendingRename();

      try {
        const moveFn = node.kind === "folder" ? moveFolder : moveDocument;
        await moveFn(renamingPath, newPath);
      } catch (err) {
        useFileTreeStore.getState().rollbackTree(snapshot);
        useToastStore
          .getState()
          .addToast(`Rename failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
    [renamingPath, tree],
  );

  const handleRenameCancel = useCallback(() => {
    useFileTreeStore.getState().clearPendingRename();
  }, []);

  const handleCreateConfirm = useCallback(
    async (name: string) => {
      if (!creating) return;
      const fullPath = creating.parentPath ? `${creating.parentPath}/${name}` : name;
      useFileTreeStore.getState().clearPendingCreation();

      try {
        if (creating.type === "file") {
          await createDocument(fullPath);
          openTab(fullPath);
        } else {
          await createFolder(fullPath);
        }
      } catch (err) {
        useToastStore
          .getState()
          .addToast(
            `Failed to create: ${err instanceof Error ? err.message : String(err)}`,
            "error",
          );
      }
    },
    [creating, openTab],
  );

  const handleSelect = useCallback(
    (path: string) => {
      setSelected(path);
    },
    [setSelected],
  );

  const flattenVisible = useCallback(
    (nodes: TreeNode[]): TreeNode[] => {
      const result: TreeNode[] = [];
      for (const node of nodes) {
        result.push(node);
        if (node.kind === "folder" && expandedPaths.has(node.path) && node.children) {
          result.push(...flattenVisible(node.children));
        }
      }
      return result;
    },
    [expandedPaths],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const flat = flattenVisible(tree);
      const idx = flat.findIndex((n) => n.path === selectedPath);

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (idx < flat.length - 1) setSelected(flat[idx + 1]!.path);
          break;
        case "ArrowUp":
          e.preventDefault();
          if (idx > 0) setSelected(flat[idx - 1]!.path);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (idx >= 0 && flat[idx]!.kind === "folder") {
            if (!expandedPaths.has(flat[idx]!.path)) {
              toggleExpanded(flat[idx]!.path);
            } else if (flat[idx + 1]) {
              setSelected(flat[idx + 1]!.path);
            }
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (idx >= 0) {
            const node = flat[idx]!;
            if (node.kind === "folder" && expandedPaths.has(node.path)) {
              toggleExpanded(node.path);
            } else {
              const parentPath = node.path.includes("/")
                ? node.path.substring(0, node.path.lastIndexOf("/"))
                : null;
              if (parentPath) setSelected(parentPath);
            }
          }
          break;
        case "Home":
          e.preventDefault();
          if (flat.length > 0) setSelected(flat[0]!.path);
          break;
        case "End":
          e.preventDefault();
          if (flat.length > 0) setSelected(flat[flat.length - 1]!.path);
          break;
        case "Enter":
          e.preventDefault();
          if (idx >= 0) {
            const node = flat[idx]!;
            if (node.kind === "folder") {
              toggleExpanded(node.path);
            } else {
              openTab(node.path);
            }
          }
          break;
        default:
          if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
            const char = e.key.toLowerCase();
            const startIdx = idx >= 0 ? idx + 1 : 0;
            const match =
              flat.slice(startIdx).find((n) => n.name.toLowerCase().startsWith(char)) ??
              flat.slice(0, startIdx).find((n) => n.name.toLowerCase().startsWith(char));
            if (match) setSelected(match.path);
          }
          break;
      }
    },
    [tree, selectedPath, expandedPaths, flattenVisible, setSelected, toggleExpanded, openTab],
  );

  useEffect(() => {
    const executeDeleteSelected = () => {
      const selected = useFileTreeStore.getState().selectedPath;
      if (selected) {
        const node = findNode(useFileTreeStore.getState().tree, selected);
        if (node) handleDelete(node);
      }
    };

    const commands = [
      {
        id: "file.rename",
        label: "Rename",
        shortcut: "F2",
        context: "sidebar" as const,
        execute: () => {
          const selected = useFileTreeStore.getState().selectedPath;
          if (selected) {
            useFileTreeStore.getState().setPendingRename(selected);
          }
        },
      },
      {
        id: "file.delete",
        label: "Delete",
        shortcut: "Delete",
        context: "sidebar" as const,
        execute: executeDeleteSelected,
      },
      {
        id: "file.delete-backspace",
        label: "Delete",
        shortcut: "Backspace",
        context: "sidebar" as const,
        execute: executeDeleteSelected,
      },
    ];

    for (const cmd of commands) {
      useCommandStore.getState().registerCommand(cmd);
    }

    return () => {
      for (const cmd of commands) {
        useCommandStore.getState().unregisterCommand(cmd.id);
      }
    };
  }, []);

  if (tree.length === 0 && !creating) {
    return (
      <div className="px-3 py-4" style={{ fontSize: 11, color: "var(--color-fg-disabled)" }}>
        No files yet
      </div>
    );
  }

  return (
    <div
      ref={treeRef}
      role="tree"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => handleContextMenu(e, null)}
      onFocus={() => useFocusContextStore.getState().setActiveRegion("sidebar")}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropTarget("__root__");
      }}
      onDragLeave={() => setDropTarget(null)}
      onDrop={(e) => {
        e.preventDefault();
        const sourcePath = e.dataTransfer.getData("text/plain");
        handleDrop(sourcePath, null);
      }}
      style={{
        outline: "none",
        background: dropTarget === "__root__" ? "var(--color-bg-selected)" : undefined,
      }}
    >
      {creating && creating.parentPath === "" && (
        <CreationInput
          kind={creating.type}
          depth={0}
          onConfirm={handleCreateConfirm}
          onCancel={() => useFileTreeStore.getState().clearPendingCreation()}
        />
      )}
      {tree.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          onContextMenu={handleContextMenu}
          renamingPath={renamingPath}
          onRenameConfirm={handleRenameConfirm}
          onRenameCancel={handleRenameCancel}
          onRenameStart={(path) => useFileTreeStore.getState().setPendingRename(path)}
          onSelect={handleSelect}
          creating={creating}
          onCreateConfirm={handleCreateConfirm}
          onCreateCancel={() => useFileTreeStore.getState().clearPendingCreation()}
          dragging={dragging}
          dropTarget={dropTarget}
          onDragStart={(n) => setDragging(n.path)}
          onDragOver={(n) => setDropTarget(n.path)}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(sourcePath, targetNode) => handleDrop(sourcePath, targetNode)}
        />
      ))}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getMenuItems(contextMenu.target)}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
