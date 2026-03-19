import { describe, it, expect } from "vitest";
import type { DisplayMessage } from "../stores/types";
import { isNewTurn } from "./chat-utils";

function msg(role: DisplayMessage["role"], timestamp: string, id?: string): DisplayMessage {
  return {
    id: id ?? crypto.randomUUID(),
    role,
    content: "test",
    timestamp,
    ...(role === "tool-group"
      ? {
          toolCalls: [{ id: "tc1", name: "Read file", status: "completed" as const }],
        }
      : {}),
  };
}

describe("isNewTurn", () => {
  it("returns false for the first message", () => {
    const messages = [msg("user", "1:00 PM")];
    expect(isNewTurn(messages, 0)).toBe(false);
  });

  it("returns true when role changes from user to assistant", () => {
    const messages = [msg("user", "1:00 PM"), msg("assistant", "1:01 PM")];
    expect(isNewTurn(messages, 1)).toBe(true);
  });

  it("returns true when role changes from assistant to user", () => {
    const messages = [msg("assistant", "1:00 PM"), msg("user", "1:01 PM")];
    expect(isNewTurn(messages, 1)).toBe(true);
  });

  it("returns false for consecutive assistant messages", () => {
    const messages = [msg("assistant", "1:00 PM"), msg("assistant", "1:01 PM")];
    expect(isNewTurn(messages, 1)).toBe(false);
  });

  it("returns false for tool-group messages", () => {
    const messages = [msg("assistant", "1:00 PM"), msg("tool-group", "1:00 PM")];
    expect(isNewTurn(messages, 1)).toBe(false);
  });

  it("detects turn change across tool-groups", () => {
    const messages = [
      msg("assistant", "1:00 PM"),
      msg("tool-group", "1:00 PM"),
      msg("user", "1:05 PM"),
    ];
    // user after assistant (with tool-group in between) is a new turn
    expect(isNewTurn(messages, 2)).toBe(true);
  });

  it("returns false for same role across tool-groups", () => {
    const messages = [
      msg("assistant", "1:00 PM"),
      msg("tool-group", "1:00 PM"),
      msg("assistant", "1:01 PM"),
    ];
    expect(isNewTurn(messages, 2)).toBe(false);
  });

  it("handles multiple tool-groups between speakers", () => {
    const messages = [
      msg("assistant", "1:00 PM"),
      msg("tool-group", "1:00 PM"),
      msg("tool-group", "1:01 PM"),
      msg("user", "1:05 PM"),
    ];
    expect(isNewTurn(messages, 3)).toBe(true);
  });

  it("returns false when only tool-groups precede", () => {
    const messages = [msg("tool-group", "1:00 PM"), msg("assistant", "1:01 PM")];
    // No non-tool-group message found before — no turn change
    expect(isNewTurn(messages, 1)).toBe(false);
  });
});
