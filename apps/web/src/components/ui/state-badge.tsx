import type { AgentState } from "@emergent/contracts";
import { Badge, type BadgeVariant } from "./badge";

const stateVariantMap: Record<AgentState, BadgeVariant> = {
  booting: "warning",
  working: "success",
  stalled: "danger",
  zombie: "default",
  completed: "info",
};

interface StateBadgeProps {
  state: AgentState;
  className?: string;
}

export function StateBadge({ state, className }: StateBadgeProps) {
  return (
    <Badge variant={stateVariantMap[state]} className={className}>
      {state}
    </Badge>
  );
}
