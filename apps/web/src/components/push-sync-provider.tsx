import type { ReactNode } from "react";
import { useWorkspaceStore } from "../stores/workspace-store";
import { usePushSync } from "../hooks/use-push-sync";

export function PushSyncProvider({ children }: { children: ReactNode }) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  usePushSync(activeWorkspaceId);
  return children;
}
