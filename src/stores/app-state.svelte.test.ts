import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { flushSync } from "svelte";
import { appState } from "./app-state.svelte";

describe("appState.updateAgentSystemPrompt", () => {
  const agentId = "vitest-system-prompt-agent";

  beforeEach(() => {
    appState.demoMode = false;
    flushSync();
  });

  afterEach(() => {
    appState.updateAgentSystemPrompt(agentId, "");
    delete appState.agentDefinitionsMap[agentId];
    appState.selectedAgentId = null;
    flushSync();
  });

  it("updates selectedAgentDef.systemPrompt without invoking the backend", () => {
    appState.agentDefinitionsMap[agentId] = {
      id: agentId,
      workspace_id: "ws-vitest",
      name: "Vitest agent",
      cli: "claude-agent-acp",
      provider: "claude",
    };
    appState.selectedAgentId = agentId;
    flushSync();

    expect(appState.selectedAgentDef?.systemPrompt).toBe("");

    appState.updateAgentSystemPrompt(agentId, "You are concise.");
    flushSync();

    expect(appState.selectedAgentDef?.systemPrompt).toBe("You are concise.");
  });
});
