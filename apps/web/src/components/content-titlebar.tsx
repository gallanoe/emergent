import { isElectron } from "../env";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function ContentTitlebar() {
  if (!isElectron) return null;

  return (
    <div className="drag-region flex h-[52px] shrink-0 items-center justify-center border-b border-neutral-800">
      <WorkspaceSwitcher />
    </div>
  );
}
