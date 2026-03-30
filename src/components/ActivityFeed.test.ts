import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import ActivityFeed from "./ActivityFeed.svelte";
import type { SwarmMessageLogEntry } from "../stores/types";

function makeEntry(overrides?: Partial<SwarmMessageLogEntry>): SwarmMessageLogEntry {
  return {
    id: "msg-1",
    fromName: "Claude",
    toName: "Gemini",
    preview: "Here are the top papers I found",
    timestamp: "2:41 PM",
    ...overrides,
  };
}

describe("ActivityFeed", () => {
  it("renders entries with sender and receiver", () => {
    render(ActivityFeed, { props: { entries: [makeEntry()] } });
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText("Gemini")).toBeTruthy();
  });

  it("renders entry preview text", () => {
    render(ActivityFeed, { props: { entries: [makeEntry()] } });
    expect(screen.getByText("Here are the top papers I found")).toBeTruthy();
  });

  it("renders timestamps", () => {
    render(ActivityFeed, { props: { entries: [makeEntry()] } });
    expect(screen.getByText("2:41 PM")).toBeTruthy();
  });

  it("renders activity header", () => {
    render(ActivityFeed, { props: { entries: [makeEntry()] } });
    expect(screen.getByText("Activity")).toBeTruthy();
  });

  it("shows empty state when no entries", () => {
    render(ActivityFeed, { props: { entries: [] } });
    expect(screen.getByText("No activity yet")).toBeTruthy();
  });
});
