import type { DisplayMessage, QueueItem } from "../stores/types";

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

/**
 * Split the backend queue mirror into the composer's user-only queue and the
 * transcript's read-only notification queue. A missing `source` is treated as
 * "user" (back-compat with items that predate source tagging).
 */
export function partitionPendingQueue(items: QueueItem[]): {
  composer: QueueItem[];
  notifications: QueueItem[];
} {
  const composer: QueueItem[] = [];
  const notifications: QueueItem[] = [];
  for (const item of items) {
    if (item.source === "task" || item.source === "thread") {
      notifications.push(item);
    } else {
      composer.push(item);
    }
  }
  return { composer, notifications };
}
