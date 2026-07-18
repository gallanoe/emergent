import { describe, it, expect } from "vitest";
import type { QueueItem } from "../stores/types";
import { partitionPendingQueue } from "./chat-utils";

describe("partitionPendingQueue", () => {
  const items: QueueItem[] = [
    { id: "u1", content: "a", submittedAt: 1, source: "user" },
    { id: "t1", content: "ping", submittedAt: 2, source: "thread" },
    { id: "k1", content: "done", submittedAt: 3, source: "task" },
    { id: "u2", content: "b", submittedAt: 4, source: "user" },
  ];

  it("puts user items in composer, task/thread in notifications, preserving order", () => {
    const { composer, notifications } = partitionPendingQueue(items);
    expect(composer.map((i) => i.id)).toEqual(["u1", "u2"]);
    expect(notifications.map((i) => i.id)).toEqual(["t1", "k1"]);
  });

  it("treats a missing source as user (back-compat)", () => {
    const { composer } = partitionPendingQueue([{ id: "x", content: "c", submittedAt: 1 }]);
    expect(composer.map((i) => i.id)).toEqual(["x"]);
  });
});
