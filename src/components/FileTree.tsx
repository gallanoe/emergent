import { useCallback, useRef, useState } from "react";
import { useFileTreeStore } from "../stores/file-tree";
import { useEditorStore } from "../stores/editor";
import type { TreeNode } from "../lib/tauri";
import { ContextMenu, type MenuItem } from "./ContextMenu";

const INDENT = 16;
const ITEM_HEIGHT = 28;

function FileTreeNode({
  node,
  depth,
  onContextMenu,
}: {
  node: TreeNode;
  depth: number;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
}) {
  const { expandedPaths, selectedPath, toggleExpanded, setSelected } = useFileTreeStore();
  const openTab = useEditorStore((s) => s.openTab);
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const isFolder = node.kind === "folder";

  const handleClick = useCallback(() => {
    setSelected(node.path);
    if (isFolder) {
      toggleExpanded(node.path);
    } else {
      openTab(node.path);
    }
  }, [node.path, isFolder, setSelected, toggleExpanded, openTab]);

  return (
    <>
      <div
        onClick={handleClick}
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
        <span className="truncate">{node.name}</span>
      </div>
      {isFolder && isExpanded && node.children && (
        <>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onContextMenu={onContextMenu}
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

  const handleContextAction = useCallback((_action: string) => {
    setContextMenu(null);
  }, []);

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
        <FileTreeNode key={node.path} node={node} depth={0} onContextMenu={handleContextMenu} />
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
