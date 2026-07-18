/**
 * Listener teardown: `teardown()` must detach every Tauri listener and leave the
 * store re-subscribable, so an HMR reload or a remounting test cannot stack a
 * second set of listeners on the same events and double-apply notifications.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { agentStore } from "./agents.svelte";

/**
 * Tauri's `listen()` / unlisten both round-trip through the event plugin, so the
 * IPC mock can count subscriptions without reaching a real backend.
 */
function trackEventIPC() {
  const listened: string[] = [];
  let unlistenCount = 0;
  let handlerId = 0;

  mockIPC((cmd, args) => {
    if (cmd === "plugin:event|listen") {
      listened.push((args as { event: string }).event);
      return ++handlerId;
    }
    if (cmd === "plugin:event|unlisten") {
      unlistenCount += 1;
      return null;
    }
    return null;
  });

  return {
    get listened() {
      return listened;
    },
    get unlistenCount() {
      return unlistenCount;
    },
  };
}

afterEach(() => {
  agentStore.teardown();
  clearMocks();
  vi.restoreAllMocks();
});

describe("agentStore.teardown", () => {
  it("unlistens every listener it registered", async () => {
    const ipc = trackEventIPC();

    await agentStore.setupListeners();
    const registered = ipc.listened.length;
    expect(registered).toBeGreaterThan(0);

    agentStore.teardown();
    expect(ipc.unlistenCount).toBe(registered);
  });

  it("does not stack listeners across a teardown/re-setup cycle", async () => {
    const ipc = trackEventIPC();

    await agentStore.setupListeners();
    const firstPass = [...ipc.listened];
    // Guard against a vacuous pass: if setup registered nothing (e.g. because a
    // previous test left listenersReady stuck true), comparing [] to [] would
    // succeed while proving nothing.
    expect(firstPass.length).toBeGreaterThan(0);

    agentStore.teardown();
    await agentStore.setupListeners();

    const secondPass = ipc.listened.slice(firstPass.length);
    // Re-setup must subscribe to exactly the same event set — not a superset,
    // and not nothing (which would mean listenersReady was left stuck true).
    expect(secondPass).toEqual(firstPass);
  });

  it("abandons a setup that a teardown interrupts, leaving no partial subscription", async () => {
    const listened: string[] = [];
    let unlistenCount = 0;
    let handlerId = 0;
    let tornDown = false;

    mockIPC((cmd, args) => {
      if (cmd === "plugin:event|listen") {
        listened.push((args as { event: string }).event);
        // Tear down partway through, simulating an HMR reload landing while
        // setupListeners is still awaiting its listen() calls.
        if (listened.length === 3 && !tornDown) {
          tornDown = true;
          agentStore.teardown();
        }
        return ++handlerId;
      }
      if (cmd === "plugin:event|unlisten") {
        unlistenCount += 1;
        return null;
      }
      return null;
    });

    await agentStore.setupListeners();

    expect(tornDown).toBe(true);
    expect(listened.length).toBeGreaterThan(3);
    // Every listener that got registered must be unlistened — the ones the
    // teardown itself caught, plus the ones registered after it.
    expect(unlistenCount).toBe(listened.length);

    // And the store must not believe it is subscribed, so a later setup redoes
    // the full set rather than silently running with a partial one.
    const before = listened.length;
    await agentStore.setupListeners();
    expect(listened.length - before).toBe(before);
  });

  it("is idempotent — a second teardown unlistens nothing further", async () => {
    const ipc = trackEventIPC();

    await agentStore.setupListeners();
    expect(ipc.listened.length).toBeGreaterThan(0);

    agentStore.teardown();
    const afterFirst = ipc.unlistenCount;
    expect(afterFirst).toBeGreaterThan(0);

    agentStore.teardown();
    expect(ipc.unlistenCount).toBe(afterFirst);
  });
});
