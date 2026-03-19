<script lang="ts">
  import { appState } from "./stores/app-state.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import TopBar from "./components/TopBar.svelte";
  import ChatArea from "./components/ChatArea.svelte";
  import ChatInput from "./components/ChatInput.svelte";
  import { onMount } from "svelte";

  onMount(() => {
    appState.initialize();
  });
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
    onSelectAgent={(id) => (appState.selectedAgentId = id)}
    onToggleSwarm={(id) => appState.toggleSwarmCollapsed(id)}
    onNewSwarm={() => appState.newSwarm()}
    onAddAgent={(swarmId) => {
      const agent = appState.availableAgents[0];
      if (agent) appState.addAgentToSwarm(swarmId, agent.binary);
    }}
  />
  <main class="flex flex-col min-h-0">
    <TopBar agent={appState.selectedAgent} />
    <ChatArea agent={appState.selectedAgent} />
    <ChatInput
      agent={appState.selectedAgent}
      demoMode={appState.demoMode}
      onSend={(text) => {
        const agent = appState.selectedAgent;
        if (agent) appState.sendPrompt(agent.id, text);
      }}
    />
  </main>
</div>
