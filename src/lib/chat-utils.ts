import type { DisplayMessage } from "../stores/types";

/** Roles that are part of the agent's turn (not the user). */
function isAgentRole(role: DisplayMessage["role"]): boolean {
  return role === "assistant" || role === "thinking";
}

/** Returns true when the speaker changes (user↔agent), ignoring tool-groups and thinking. */
export function isNewTurn(messages: DisplayMessage[], index: number): boolean {
  if (index === 0) return false;
  const current = messages[index]!;
  if (current.role === "tool-group") return false;
  for (let j = index - 1; j >= 0; j--) {
    const prev = messages[j]!;
    if (prev.role !== "tool-group") {
      return isAgentRole(prev.role) !== isAgentRole(current.role);
    }
  }
  return false;
}
