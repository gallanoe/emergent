<script lang="ts">
  import { appState } from "./stores/mock-data.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import TopBar from "./components/TopBar.svelte";
  import ChatArea from "./components/ChatArea.svelte";
  import ChatInput from "./components/ChatInput.svelte";
</script>

<div class="grid grid-cols-[240px_1fr] h-screen">
  <Sidebar
    swarms={appState.swarms}
    selectedAgentId={appState.selectedAgentId}
    onSelectAgent={(id) => (appState.selectedAgentId = id)}
    onToggleSwarm={(id) => appState.toggleSwarmCollapsed(id)}
  />
  <main class="flex flex-col min-h-0">
    <TopBar agent={appState.selectedAgent} />
    <ChatArea agent={appState.selectedAgent} />
    <ChatInput />
  </main>
</div>
