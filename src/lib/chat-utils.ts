import type { DisplayMessage } from "../stores/types";

/** Returns true if the timestamp should be displayed for the message at `index`. */
export function shouldShowTimestamp(messages: DisplayMessage[], index: number): boolean {
  if (index === 0) return true;
  const current = messages[index]!;
  const prev = messages[index - 1]!;
  if (current.role === "tool-group") return false;
  return current.timestamp !== prev.timestamp;
}

/** Returns true when the speaker changes (user↔assistant), ignoring tool-groups. */
export function isNewTurn(messages: DisplayMessage[], index: number): boolean {
  if (index === 0) return false;
  const current = messages[index]!;
  if (current.role === "tool-group") return false;
  for (let j = index - 1; j >= 0; j--) {
    const prev = messages[j]!;
    if (prev.role !== "tool-group") {
      return prev.role !== current.role;
    }
  }
  return false;
}
