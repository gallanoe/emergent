import type { QueueItem } from "../stores/types";

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
