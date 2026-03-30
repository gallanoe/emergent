<script lang="ts">
  import { appState } from "./stores/app-state.svelte";
  import SwarmRail from "./components/SwarmRail.svelte";
  import InnerSidebar from "./components/InnerSidebar.svelte";
  import TopBar from "./components/TopBar.svelte";
  import ChatArea from "./components/ChatArea.svelte";
  import ChatInput from "./components/ChatInput.svelte";
  import SwarmView from "./components/SwarmView.svelte";
  import ConfirmDialog from "./components/ConfirmDialog.svelte";
  import { onMount } from "svelte";

  let externalContent = $state<{ text: string; seq: number } | null>(null);
  let seq = 0;
  let shutdownTarget = $state<{ id: string; name: string } | null>(null);

  function pushToInput(text: string) {
    externalContent = { text, seq: ++seq };
  }

  function requestShutdown(agentId: string, agentName: string) {
    shutdownTarget = { id: agentId, name: agentName };
  }

  async function confirmShutdown() {
    if (!shutdownTarget) return;
    const id = shutdownTarget.id;
    shutdownTarget = null;
    await appState.killAgent(id);
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

<div class="grid grid-cols-[56px_200px_1fr] h-screen">
  <SwarmRail
    swarms={appState.swarms}
    selectedSwarmId={appState.selectedSwarmId}
    demoMode={appState.demoMode}
    onSelectSwarm={(id) => appState.selectSwarm(id)}
    onNewSwarm={() => appState.newSwarm()}
  />
  <InnerSidebar
    swarm={appState.selectedSwarm}
    activeView={appState.activeView}
    selectedAgentId={appState.selectedAgentId}
    onSelectView={(view) => {
      if (view === "swarm" && appState.selectedSwarmId) {
        appState.selectSwarm(appState.selectedSwarmId);
      }
    }}
    onSelectAgent={(id) => appState.selectAgent(id)}
  />
  <main class="flex flex-col min-h-0 min-w-0">
    {#if appState.activeView === "swarm" && appState.selectedSwarm}
      <SwarmView
        swarm={appState.selectedSwarm}
        messageLog={appState.swarmMessageLog}
        agentConnections={appState.agentConnections}
        demoMode={appState.demoMode}
        knownAgents={appState.knownAgents}
        onSelectAgent={(id) => appState.selectAgent(id)}
        onAddAgent={(swarmId, cmd, name) =>
          appState.addAgentToSwarm(swarmId, cmd, name)}
      />
    {:else}
      <TopBar
        agent={appState.selectedAgent}
        allAgents={appState.swarms.flatMap((s) => s.agents)}
        connections={appState.selectedAgent
          ? (appState.agentConnections[appState.selectedAgent.id] ?? [])
          : []}
        onShutdown={() => {
          const agent = appState.selectedAgent;
          if (agent) requestShutdown(agent.id, agent.name);
        }}
        onConnect={(targetId) => {
          const agent = appState.selectedAgent;
          if (agent) appState.connectAgents(agent.id, targetId);
        }}
        onDisconnect={(targetId) => {
          const agent = appState.selectedAgent;
          if (agent) appState.disconnectAgents(agent.id, targetId);
        }}
        onSetPermissions={(enabled) => {
          const agent = appState.selectedAgent;
          if (agent) appState.setAgentPermissions(agent.id, enabled);
        }}
      />
      <ChatArea
        agent={appState.selectedAgent}
        onEditQueue={handleEditQueue}
        onRoleChange={(role) => {
          const agent = appState.selectedAgent;
          if (agent) appState.setRole(agent.id, role);
        }}
      />
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
        onSetConfig={(configId, value) => {
          const agent = appState.selectedAgent;
          if (agent) appState.setConfig(agent.id, configId, value);
        }}
      />
    {/if}
  </main>
</div>

{#if shutdownTarget}
  <ConfirmDialog
    title="Shutdown {shutdownTarget.name}?"
    description="Any in-progress work will be stopped immediately. This cannot be undone."
    confirmLabel="Shutdown"
    onConfirm={confirmShutdown}
    onCancel={() => {
      shutdownTarget = null;
    }}
  />
{/if}
