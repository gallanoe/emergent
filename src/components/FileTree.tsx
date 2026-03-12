import { useCallback, useEffect, useRef, useState } from "react";
import { useFileTreeStore } from "../stores/file-tree";
import { useEditorStore } from "../stores/editor";
import type { TreeNode } from "../lib/tauri";
import { moveDocument, moveFolder } from "../lib/tauri";
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

function FileTreeNode({
  node,
  depth,
  onContextMenu,
  renamingPath,
  onRenameConfirm,
  onRenameCancel,
  onRenameStart,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  renamingPath: string | null;
  onRenameConfirm: (newName: string) => void;
  onRenameCancel: () => void;
  onRenameStart: (path: string) => void;
  onSelect: (path: string) => void;
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
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => onContextMenu(e, node)}
        className="flex cursor-default items-center px-2"
        style={{
          height: ITEM_HEIGHT,
          paddingLeft: depth * INDENT + 8,
          fontSize: 13,
          color: isSelected ? "var(--color-fg-heading)" : "var(--color-fg-default)",
          background: isSelected ? "var(--color-bg-hover)" : "transparent",
          borderLeft: isSelected ? "2px solid var(--color-accent)" : "2px solid transparent",
          transition: "background 100ms ease-out",
        }}
        onMouseEnter={(e) => {
          if (!isSelected) {
            e.currentTarget.style.background = "var(--color-bg-hover)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isSelected) {
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
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
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

  const handleContextAction = useCallback(
    (action: string) => {
      const target = contextMenu?.target;
      setContextMenu(null);
      if (action === "rename" && target) {
        setRenamingPath(target.path);
      }
    },
    [contextMenu],
  );

  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      if (!renamingPath) return;
      const node = findNode(tree, renamingPath);
      if (!node || !newName.trim() || newName === node.name) {
        setRenamingPath(null);
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
      setRenamingPath(null);

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
    setRenamingPath(null);
  }, []);

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
        case "F2":
          e.preventDefault();
          if (selectedPath) setRenamingPath(selectedPath);
          break;
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

  if (tree.length === 0) {
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
      style={{ outline: "none" }}
    >
      {tree.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          onContextMenu={handleContextMenu}
          renamingPath={renamingPath}
          onRenameConfirm={handleRenameConfirm}
          onRenameCancel={handleRenameCancel}
          onRenameStart={setRenamingPath}
          onSelect={handleSelect}
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
