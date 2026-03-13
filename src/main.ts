// src/main.ts
import { mount } from "svelte";
import App from "./App.svelte";
import "./index.css";
import {
  onTreeChanged,
  onBranchSwitched,
  onWorkspaceOpened,
  onDocumentChanged,
  onMergeConflict,
  onCommitCreated,
  listTree,
} from "./lib/tauri";
import { sortTree } from "./lib/sort-tree";
import { fileTreeStore } from "./stores/file-tree.svelte";
import { workspaceStore } from "./stores/workspace.svelte";
import { editorStore } from "./stores/editor.svelte";
import { toastStore } from "./stores/toast.svelte";

mount(App, { target: document.getElementById("root")! });

// Global event listeners — fire-and-forget, live for app lifetime
onTreeChanged(async () => {
  const tree = await listTree();
  fileTreeStore.setTree(sortTree(tree));
});

onBranchSwitched(({ name }) => {
  workspaceStore.setCurrentBranch(name);
});

onWorkspaceOpened(({ name, branch }) => {
  workspaceStore.setCurrentBranch(branch);
  toastStore.addToast(`Opened "${name}"`, "info");
});

onDocumentChanged(async ({ path }) => {
  if (editorStore.activeTab === path) {
    const tree = await listTree();
    fileTreeStore.setTree(sortTree(tree));
  }
});

onMergeConflict(({ conflicts }) => {
  workspaceStore.setMergeState({
    conflicts: conflicts.map((p) => ({ path: p, ours: "", theirs: "" })),
  });
  toastStore.addToast(`Merge conflict in ${conflicts.length} file(s)`, "error");
});

onCommitCreated(({ message }) => {
  toastStore.addToast(`Committed: ${message}`, "success");
});
