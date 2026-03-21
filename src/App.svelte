<script lang="ts">
  import { appState } from "./stores/app-state.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import TopBar from "./components/TopBar.svelte";
  import ChatArea from "./components/ChatArea.svelte";
  import ChatInput from "./components/ChatInput.svelte";
  import { onMount } from "svelte";

  let externalContent = $state<{ text: string; seq: number } | null>(null);
  let seq = 0;

  function pushToInput(text: string) {
    externalContent = { text, seq: ++seq };
  }

  onMount(() => {
    appState.initialize();

    // Register handler for queue dump on error.
    // Only dump if the errored agent is currently selected — otherwise
    // the content would be sent to the wrong agent.
    appState.registerQueueDumpHandler((agentId: string, content: string) => {
      if (agentId === appState.selectedAgentId) {
        pushToInput(content);
      }
    });
  });

  function handleEditQueue() {
    const agent = appState.selectedAgent;
    if (!agent) return;
    const content = appState.editQueue(agent.id);
    if (content) {
      pushToInput(content);
    }
  }
</script>

<!-- Drag region overlay for window dragging -->
<div
  class="fixed top-0 left-0 right-0 h-[38px] z-50"
  data-tauri-drag-region
></div>

<div class="grid grid-cols-[240px_1fr] h-screen">
  <Sidebar
    swarms={appState.swarms}
    selectedAgentId={appState.selectedAgentId}
    demoMode={appState.demoMode}
    knownAgents={appState.knownAgents}
    onSelectAgent={(id) => (appState.selectedAgentId = id)}
    onToggleSwarm={(id) => appState.toggleSwarmCollapsed(id)}
    onNewSwarm={() => appState.newSwarm()}
    onAddAgent={(swarmId, agentCommand) => {
      appState.addAgentToSwarm(swarmId, agentCommand);
    }}
  />
  <main class="flex flex-col min-h-0">
    <TopBar agent={appState.selectedAgent} />
    <ChatArea agent={appState.selectedAgent} onEditQueue={handleEditQueue} />
    <ChatInput
      agent={appState.selectedAgent}
      demoMode={appState.demoMode}
      {externalContent}
      onSend={(text) => {
        const agent = appState.selectedAgent;
        if (agent) appState.sendPrompt(agent.id, text);
      }}
      onInterrupt={() => {
        const agent = appState.selectedAgent;
        if (agent) appState.cancelPrompt(agent.id);
      }}
    />
  </main>
</div>
