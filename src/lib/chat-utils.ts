import type { DisplayMessage } from "../stores/types";

/** Roles that are part of the agent's turn (not the user). */
function isAgentRole(role: DisplayMessage["role"]): boolean {
  return role === "assistant" || role === "thinking";
}

/** Returns true if the timestamp should be displayed for the message at `index`. */
export function shouldShowTimestamp(messages: DisplayMessage[], index: number): boolean {
  if (index === 0) return true;
  const current = messages[index]!;
  const prev = messages[index - 1]!;
  if (current.role === "tool-group" || current.role === "thinking") return false;
  return current.timestamp !== prev.timestamp;
}

/** Returns true when the speaker changes (user↔agent), ignoring tool-groups and thinking. */
export function isNewTurn(messages: DisplayMessage[], index: number): boolean {
  if (index === 0) return false;
  const current = messages[index]!;
  if (current.role === "tool-group") return false;
  for (let j = index - 1; j >= 0; j--) {
    const prev = messages[j]!;
    if (prev.role !== "tool-group") {
      // thinking and assistant are both agent turns
      return isAgentRole(prev.role) !== isAgentRole(current.role);
    }
  }
  return false;
}
