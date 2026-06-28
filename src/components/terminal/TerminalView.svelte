<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getOrCreate, dispose, attachSession } from "./terminal-instances";
  import "@xterm/xterm/css/xterm.css";

  interface Props {
    workspaceId: string;
    sessionId: string | null;
    onSessionCreated: (sessionId: string) => void;
    onSessionEnded: () => void;
  }

  let { workspaceId, sessionId, onSessionCreated, onSessionEnded }: Props =
    $props();

  let terminalEl: HTMLDivElement | undefined = $state();
  let connected = $derived(sessionId !== null);
  let exited = $state(false);
  let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

  let resizeObserver: ResizeObserver | undefined;

  // The instance + closure we registered `onExited` on, captured so `onDestroy`
  // clears the RIGHT one: `workspaceId` (a prop) may already point at a newly
  // selected workspace by the time destroy runs.
  let boundInstance: ReturnType<typeof getOrCreate> | undefined;
  let exitHandler: (() => void) | undefined;

  // The session's output/exit listeners live on the cached instance (see
  // terminal-instances.ts) so they persist while this view is unmounted. The
  // view only observes the exit signal to refresh its own chrome.
  function bindExitObserver() {
    const instance = getOrCreate(workspaceId);
    exited = instance.exited;
    exitHandler = () => {
      exited = true;
      onSessionEnded();
    };
    instance.onExited = exitHandler;
    boundInstance = instance;
  }

  async function createSession() {
    try {
      const sid: string = await invoke("create_terminal_session", {
        workspaceId,
      });
      onSessionCreated(sid);
      exited = false;
      await attachSession(workspaceId, sid);
      // Send initial resize after session creation
      const { terminal } = getOrCreate(workspaceId);
      await invoke("resize_terminal", {
        sessionId: sid,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    } catch (e) {
      console.error("Failed to create terminal session:", e);
    }
  }

  function handleResize() {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const { terminal, fitAddon } = getOrCreate(workspaceId);
      fitAddon.fit();
      if (sessionId && connected && !exited) {
        invoke("resize_terminal", {
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      }
    }, 100);
  }

  async function reconnect() {
    // Close the previous backend session (if any) so its shell + PTY don't leak.
    if (sessionId) {
      try {
        await invoke("close_terminal_session", { sessionId });
      } catch {
        // already exited / removed by the backend — ignore
      }
    }
    dispose(workspaceId); // tears down the old session's listeners + terminal
    exited = false;
    if (terminalEl) {
      const { terminal, fitAddon } = getOrCreate(workspaceId);
      terminal.open(terminalEl); // fresh instance after dispose, so open() is safe
      fitAddon.fit();
    }
    bindExitObserver();
    await createSession();
  }

  onMount(() => {
    if (!terminalEl) return;

    const { terminal, fitAddon } = getOrCreate(workspaceId);

    if (terminal.element) {
      // Already opened before — reparent the existing DOM
      terminalEl.appendChild(terminal.element);
    } else {
      terminal.open(terminalEl);
    }
    fitAddon.fit();

    resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(terminalEl);

    bindExitObserver();

    if (sessionId) {
      // Re-attach is idempotent if the persistent listeners are already live.
      attachSession(workspaceId, sessionId);
    } else {
      createSession();
    }
  });

  onDestroy(() => {
    // Leave the session listeners attached (they persist output while unmounted);
    // only stop observing the exit signal and DOM resize for this view instance.
    // Clear the exact instance we bound to (workspaceId may have advanced), and
    // only if it's still our closure, so we never clobber a newer view's binding.
    if (boundInstance && boundInstance.onExited === exitHandler) {
      boundInstance.onExited = undefined;
    }
    resizeObserver?.disconnect();
    if (resizeTimeout) clearTimeout(resizeTimeout);
  });
</script>

<div class="flex flex-col h-full">
  <div
    class="h-9 flex items-center px-3 border-b border-border-default justify-between flex-shrink-0"
  >
    <div class="flex items-center gap-2">
      <span class="text-[12px] font-medium text-fg-heading">Terminal</span>
      <span class="text-[10px] text-fg-disabled">bash</span>
    </div>
    <div class="flex items-center gap-1.5">
      {#if exited}
        <span class="w-1.5 h-1.5 rounded-full bg-fg-disabled"></span>
        <span class="text-[10px] text-fg-muted">session ended</span>
      {:else if connected}
        <span class="w-1.5 h-1.5 rounded-full bg-success"></span>
        <span class="text-[10px] text-fg-muted">connected</span>
      {:else}
        <span class="w-1.5 h-1.5 rounded-full bg-error"></span>
        <span class="text-[10px] text-fg-muted">disconnected</span>
      {/if}
    </div>
  </div>

  <div class="relative flex-1 min-h-0">
    <div bind:this={terminalEl} class="absolute inset-0 p-1"></div>

    {#if exited || !sessionId}
      <div
        class="absolute bottom-0 left-0 right-0 flex justify-center pb-4 pt-8"
        style="background: linear-gradient(transparent, rgba(9,9,11,0.95) 40%)"
      >
        <button
          class="interactive inline-flex items-center gap-2 bg-bg-elevated border border-border-strong rounded-md px-4 py-2 text-[12px] text-fg-default font-medium"
          onclick={reconnect}
        >
          {exited ? "New session" : "Reconnect"}
        </button>
      </div>
    {/if}
  </div>
</div>
