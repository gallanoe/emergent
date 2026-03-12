import { useEffect } from "react";
import { AppShell } from "./components/AppShell";
import { WorkspacePicker } from "./components/WorkspacePicker";
import { useWorkspaceStore } from "./stores/workspace";
import { listWorkspaces } from "./lib/tauri";
import { useToastStore } from "./components/Toast";

function App() {
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);

  useEffect(() => {
    listWorkspaces()
      .then((list) => {
        useWorkspaceStore.getState().setWorkspaces(list);
      })
      .catch((err) => {
        useToastStore
          .getState()
          .addToast(
            `Failed to load workspaces: ${err instanceof Error ? err.message : String(err)}`,
            "error",
          );
      });
  }, []);

  return (
    <div className="view-fade-in" key={activeWorkspace ? "shell" : "picker"}>
      {activeWorkspace ? <AppShell /> : <WorkspacePicker />}
    </div>
  );
}

export default App;
