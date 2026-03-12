import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

import {
  onTreeChanged,
  onDocumentChanged,
  onBranchSwitched,
  onWorkspaceOpened,
  onMergeConflict,
  onCommitCreated,
  listTree,
} from "./lib/tauri";
import { useFileTreeStore } from "./stores/file-tree";
import { useWorkspaceStore } from "./stores/workspace";
import { useEditorStore } from "./stores/editor";
import { useToastStore } from "./components/Toast";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Global event listeners — fire-and-forget, live for app lifetime
onTreeChanged(async () => {
  const tree = await listTree();
  useFileTreeStore.getState().setTree(tree);
});

onBranchSwitched(({ name }) => {
  useWorkspaceStore.getState().setCurrentBranch(name);
});

onWorkspaceOpened(({ name, branch }) => {
  useWorkspaceStore.getState().setCurrentBranch(branch);
  useToastStore.getState().addToast(`Opened "${name}"`, "info");
});

onDocumentChanged(async ({ path }) => {
  const activeTab = useEditorStore.getState().activeTab;
  if (activeTab === path) {
    const tree = await listTree();
    useFileTreeStore.getState().setTree(tree);
  }
});

onMergeConflict(({ conflicts }) => {
  useWorkspaceStore.getState().setMergeState({
    conflicts: conflicts.map((p) => ({ path: p, ours: "", theirs: "" })),
  });
  useToastStore
    .getState()
    .addToast(`Merge conflict in ${conflicts.length} file(s)`, "error");
});

onCommitCreated(({ message }) => {
  useToastStore.getState().addToast(`Committed: ${message}`, "success");
});
