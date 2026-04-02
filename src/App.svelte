<script lang="ts">
  import { appState } from "./stores/app-state.svelte";
  import SwarmRail from "./components/swarm/SwarmRail.svelte";
  import InnerSidebar from "./components/sidebar/InnerSidebar.svelte";
  import TopBar from "./components/topbar/TopBar.svelte";
  import ChatArea from "./components/chat/ChatArea.svelte";
  import ChatInput from "./components/chat/ChatInput.svelte";
  import SwarmView from "./components/swarm/SwarmView.svelte";
  import SettingsView from "./components/settings/SettingsView.svelte";
  import TerminalView from "./components/terminal/TerminalView.svelte";
  import ConfirmDialog from "./components/ConfirmDialog.svelte";
  import CreateWorkspaceDialog from "./components/CreateWorkspaceDialog.svelte";
  import { Plus } from "@lucide/svelte";
  import { onMount } from "svelte";

  let externalContent = $state<{ text: string; seq: number } | null>(null);
  let seq = 0;
  let shutdownTarget = $state<{ id: string; name: string } | null>(null);
  let showCreateWorkspace = $state(false);

  const isEmptyOrDockerMissing = $derived(
    (appState.dockerStatus && !appState.dockerStatus.docker_available) ||
      (!appState.demoMode && appState.swarms.length === 0),
  );

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

<!-- Drag region overlay for window dragging (z-[100]).
     Interactive elements in the top bar must use z-[101]+ to sit above this. -->
<div
  class="fixed top-0 left-0 right-0 h-[38px] z-[100]"
  data-tauri-drag-region
></div>

<div class="grid grid-cols-[256px_1fr] h-screen">
  <div class="flex flex-col min-h-0">
    <div
      class="h-[38px] flex-shrink-0 bg-bg-sidebar border-b border-r border-border-default"
    ></div>
    <div class="flex flex-1 min-h-0">
      <SwarmRail
        workspaces={appState.swarms}
        selectedWorkspaceId={appState.selectedSwarmId}
        demoMode={appState.demoMode}
        onSelectWorkspace={(id) => appState.selectWorkspace(id)}
        onNewWorkspace={() => (showCreateWorkspace = true)}
      />
      <InnerSidebar
        swarm={appState.selectedSwarm}
        activeView={appState.activeView}
        selectedAgentId={appState.selectedAgentId}
        demoMode={appState.demoMode}
        containerRunning={appState.selectedSwarm?.containerStatus.state ===
          "running"}
        knownAgents={appState.knownAgents}
        onSelectView={(view) => {
          if (view === "swarm" && appState.selectedSwarmId) {
            appState.selectWorkspace(appState.selectedSwarmId);
          } else if (view === "settings") {
            appState.activeView = "settings";
          } else if (view === "terminal") {
            appState.activeView = "terminal";
          }
        }}
        onSelectAgent={(id) => appState.selectAgent(id)}
        onAddAgent={(swarmId, cmd, name) =>
          appState.addAgentToWorkspace(swarmId, cmd, name)}
      />
    </div>
  </div>
  <main class="flex flex-col min-h-0 min-w-0">
    {#if appState.selectedSwarm && !isEmptyOrDockerMissing}
      <div
        class="flex items-center h-[38px] px-5 border-b border-border-default flex-shrink-0 relative z-[60]"
      >
        <span class="text-[13px] font-semibold text-fg-heading"
          >{appState.selectedSwarm.name}</span
        >
      </div>
    {/if}
    {#if appState.dockerStatus && !appState.dockerStatus.docker_available}
      <div
        class="flex flex-col items-center justify-center flex-1 gap-3 text-center"
      >
        <div
          class="w-10 h-10 rounded-full bg-bg-hover flex items-center justify-center text-warning"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path
              d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"
            /><path d="M12 9v4" /><path d="M12 17h.01" /></svg
          >
        </div>
        <div class="text-[13px] font-semibold text-fg-heading">
          Docker not found
        </div>
        <div class="text-[12px] text-fg-muted max-w-xs leading-relaxed">
          Emergent requires Docker to run workspaces. Install Docker Desktop and
          restart the app.
        </div>
      </div>
    {:else if !appState.demoMode && appState.swarms.length === 0}
      <div
        class="flex flex-col items-center justify-center flex-1 gap-3 text-center"
      >
        <div
          class="w-10 h-10 rounded-full bg-bg-hover flex items-center justify-center text-fg-muted"
        >
          <Plus size={20} />
        </div>
        <div class="text-[13px] font-semibold text-fg-heading">
          No workspaces yet
        </div>
        <div class="text-[12px] text-fg-muted">
          Create a workspace to get started
        </div>
        <button
          class="mt-1 h-7 px-4 rounded-[5px] text-[12px] font-medium text-bg-base bg-accent hover:bg-accent-hover transition-colors"
          onclick={() => (showCreateWorkspace = true)}
        >
          Create Workspace
        </button>
      </div>
    {:else if appState.activeView === "settings" && appState.selectedSwarmId}
      <SettingsView
        workspaceId={appState.selectedSwarmId}
        containerStatus={appState.selectedSwarm?.containerStatus ?? {
          state: "stopped",
        }}
        onUpdateName={(name) =>
          appState.updateWorkspace(appState.selectedSwarmId!, name)}
        onStart={() => appState.startContainer(appState.selectedSwarmId!)}
        onStop={() => appState.stopContainer(appState.selectedSwarmId!)}
        onRebuild={() => appState.rebuildContainer(appState.selectedSwarmId!)}
      />
    {:else if appState.activeView === "terminal" && appState.selectedSwarmId}
      <TerminalView
        workspaceId={appState.selectedSwarmId}
        containerStatus={appState.selectedSwarm?.containerStatus ?? {
          state: "stopped",
        }}
        sessionId={appState.terminalSessionIds[appState.selectedSwarmId] ??
          null}
        onSessionCreated={(sid) =>
          appState.setTerminalSessionId(appState.selectedSwarmId!, sid)}
        onSessionEnded={() =>
          appState.setTerminalSessionId(appState.selectedSwarmId!, null)}
      />
    {:else if appState.activeView === "swarm" && appState.selectedSwarm}
      <SwarmView
        swarm={appState.selectedSwarm}
        messageLog={appState.swarmMessageLog}
        agentConnections={appState.agentConnections}
        demoMode={appState.demoMode}
        knownAgents={appState.knownAgents}
        onSelectAgent={(id) => appState.selectAgent(id)}
        onAddAgent={(swarmId, cmd, name) =>
          appState.addAgentToWorkspace(swarmId, cmd, name)}
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

{#if showCreateWorkspace}
  <CreateWorkspaceDialog
    onConfirm={async (name) => {
      showCreateWorkspace = false;
      await appState.createWorkspace(name);
    }}
    onCancel={() => (showCreateWorkspace = false)}
  />
{/if}
