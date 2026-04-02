<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import type { ContainerStatus } from "../../stores/types";
  import { getOrCreate, dispose } from "./terminal-instances";
  import "@xterm/xterm/css/xterm.css";

  interface Props {
    workspaceId: string;
    containerStatus: ContainerStatus;
    sessionId: string | null;
    onSessionCreated: (sessionId: string) => void;
    onSessionEnded: () => void;
  }

  let {
    workspaceId,
    containerStatus,
    sessionId,
    onSessionCreated,
    onSessionEnded,
  }: Props = $props();

  let terminalEl: HTMLDivElement | undefined = $state();
  let connected = $derived(
    containerStatus.state === "running" && sessionId !== null,
  );
  let exited = $state(false);
  let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

  let unlistenOutput: UnlistenFn | undefined;
  let unlistenExited: UnlistenFn | undefined;
  let dataDisposable: { dispose: () => void } | undefined;
  let resizeObserver: ResizeObserver | undefined;

  async function createSession() {
    try {
      const sid: string = await invoke("create_terminal_session", {
        workspaceId,
      });
      onSessionCreated(sid);
      exited = false;
      await setupListeners(sid);
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

  async function setupListeners(sid: string) {
    await cleanupListeners();

    const { terminal } = getOrCreate(workspaceId);

    unlistenOutput = await listen<{ session_id: string; data: string }>(
      "terminal:output",
      (e) => {
        if (e.payload.session_id !== sid) return;
        const bytes = Uint8Array.from(atob(e.payload.data), (c) =>
          c.charCodeAt(0),
        );
        terminal.write(bytes);
      },
    );

    unlistenExited = await listen<{ session_id: string }>(
      "terminal:exited",
      (e) => {
        if (e.payload.session_id !== sid) return;
        exited = true;
        onSessionEnded();
      },
    );

    dataDisposable = terminal.onData((data: string) => {
      if (!connected || exited) return;
      const bytes = Array.from(new TextEncoder().encode(data));
      invoke("write_terminal", { sessionId: sid, data: bytes });
    });
  }

  async function cleanupListeners() {
    unlistenOutput?.();
    unlistenOutput = undefined;
    unlistenExited?.();
    unlistenExited = undefined;
    dataDisposable?.dispose();
    dataDisposable = undefined;
  }

  function handleResize() {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const { terminal, fitAddon } = getOrCreate(workspaceId);
      fitAddon.fit();
      if (sessionId && connected) {
        invoke("resize_terminal", {
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      }
    }, 100);
  }

  async function reconnect() {
    dispose(workspaceId);
    exited = false;
    if (terminalEl) {
      const { terminal, fitAddon } = getOrCreate(workspaceId);
      terminal.open(terminalEl); // fresh instance after dispose, so open() is safe
      fitAddon.fit();
    }
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

    if (sessionId && containerStatus.state === "running") {
      setupListeners(sessionId);
    } else if (containerStatus.state === "running" && !sessionId) {
      createSession();
    }
  });

  onDestroy(() => {
    cleanupListeners();
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
    <div
      bind:this={terminalEl}
      class="absolute inset-0 p-1 {containerStatus.state !== 'running'
        ? 'opacity-50'
        : ''}"
    ></div>

    {#if containerStatus.state !== "running"}
      <div
        class="absolute bottom-0 left-0 right-0 flex justify-center pb-4 pt-8"
        style="background: linear-gradient(transparent, rgba(9,9,11,0.95) 40%)"
      >
        <div
          class="inline-flex items-center gap-2 bg-bg-elevated border border-border-default rounded-md px-4 py-2"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-error"></span>
          <span class="text-[12px] text-fg-muted"
            >Container stopped — start it from Settings to reconnect</span
          >
        </div>
      </div>
    {/if}

    {#if containerStatus.state === "running" && (exited || !sessionId)}
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
