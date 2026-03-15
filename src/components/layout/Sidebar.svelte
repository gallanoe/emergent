<script lang="ts">
  import FileTree from "../file-tree/FileTree.svelte";
  import { uiStore } from "../../stores/ui.svelte";
  import { workspaceStore } from "../../stores/workspace.svelte";
  import { fileTreeStore } from "../../stores/file-tree.svelte";
  import { PanelLeft, GitBranch, Plus } from "lucide-svelte";

  let width = $state(220);

  function handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const rawWidth = startWidth + moveEvent.clientX - startX;
      if (rawWidth < 120) {
        uiStore.setSidebarCollapsed(true);
      } else {
        uiStore.setSidebarCollapsed(false);
        width = Math.max(180, Math.min(400, rawWidth));
      }
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function handleNewFile() {
    uiStore.setSidebarCollapsed(false);
    fileTreeStore.setPendingCreation({ type: "file", parentPath: "" });
  }
</script>

{#if uiStore.sidebarCollapsed}
  <!-- Collapsed icon rail -->
  <div
    style="width: 44px; background: var(--color-bg-sidebar); flex-shrink: 0; position: relative;"
    class="flex flex-col items-center"
  >
    <div
      style="padding-top: 12px; gap: 4px;"
      class="flex flex-col items-center"
    >
      <button
        onclick={() => uiStore.toggleSidebar()}
        style="width: 32px; height: 32px; border-radius: 6px; color: var(--color-fg-muted); border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.1s, background-color 0.1s;"
        onmouseenter={(e) => {
          e.currentTarget.style.color = "var(--color-fg-default)";
          e.currentTarget.style.background = "var(--color-bg-elevated)";
        }}
        onmouseleave={(e) => {
          e.currentTarget.style.color = "var(--color-fg-muted)";
          e.currentTarget.style.background = "transparent";
        }}
        aria-label="Expand sidebar"
      >
        <PanelLeft size={18} />
      </button>
      <button
        onclick={() => uiStore.setActiveView("vcs")}
        style="width: 32px; height: 32px; border-radius: 6px; color: var(--color-fg-muted); border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.1s, background-color 0.1s;"
        onmouseenter={(e) => {
          e.currentTarget.style.color = "var(--color-fg-default)";
          e.currentTarget.style.background = "var(--color-bg-elevated)";
        }}
        onmouseleave={(e) => {
          e.currentTarget.style.color = "var(--color-fg-muted)";
          e.currentTarget.style.background = "transparent";
        }}
        aria-label="Source control"
      >
        <GitBranch size={18} />
      </button>
    </div>
    <!-- Right edge separator -->
    <div
      style="position: absolute; top: 0; right: 0; bottom: 0; width: 1px; background: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.06) 10%, rgba(0,0,0,0.06) 90%, transparent 100%);"
    ></div>
  </div>
{:else}
  <!-- Expanded sidebar -->
  <div
    style="width: {width}px; min-width: 180px; max-width: 400px; background: var(--color-bg-sidebar); flex-shrink: 0; position: relative; transition: opacity 200ms ease-out;"
    class="flex flex-col overflow-hidden"
  >
    <!-- Header -->
    <div
      style="padding: 16px 16px 12px;"
      class="flex items-center justify-between"
    >
      <span
        style="font-size: 13px; font-weight: 600; color: var(--color-fg-heading); letter-spacing: -0.01em;"
      >
        Workspace
      </span>
      <div class="flex items-center" style="gap: 2px;">
        <button
          onclick={handleNewFile}
          style="width: 28px; height: 28px; border-radius: 6px; color: var(--color-fg-muted); border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.1s, background-color 0.1s;"
          onmouseenter={(e) => {
            e.currentTarget.style.color = "var(--color-fg-default)";
            e.currentTarget.style.background = "var(--color-bg-elevated)";
          }}
          onmouseleave={(e) => {
            e.currentTarget.style.color = "var(--color-fg-muted)";
            e.currentTarget.style.background = "transparent";
          }}
          aria-label="New file"
        >
          <Plus size={16} />
        </button>
        <button
          onclick={() => uiStore.toggleSidebar()}
          style="width: 28px; height: 28px; border-radius: 6px; color: var(--color-fg-muted); border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.1s, background-color 0.1s;"
          onmouseenter={(e) => {
            e.currentTarget.style.color = "var(--color-fg-default)";
            e.currentTarget.style.background = "var(--color-bg-elevated)";
          }}
          onmouseleave={(e) => {
            e.currentTarget.style.color = "var(--color-fg-muted)";
            e.currentTarget.style.background = "transparent";
          }}
          aria-label="Collapse sidebar"
        >
          <PanelLeft size={16} />
        </button>
      </div>
    </div>

    <!-- Gradient separator -->
    <div
      style="height: 1px; background: linear-gradient(to right, transparent 0%, rgba(0,0,0,0.08) 15%, rgba(0,0,0,0.08) 85%, transparent 100%); margin: 0 8px;"
    ></div>

    <!-- Section label -->
    <div
      style="padding: 4px 16px; font-size: 11px; font-weight: 500; color: var(--color-fg-muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px;"
    >
      Documents
    </div>

    <!-- File tree -->
    <div class="flex-1 overflow-y-auto" style="padding: 0 8px;">
      <FileTree />
    </div>

    <!-- Footer separator -->
    <div
      style="height: 1px; background: linear-gradient(to right, transparent 0%, rgba(0,0,0,0.08) 15%, rgba(0,0,0,0.08) 85%, transparent 100%); margin: 0 8px;"
    ></div>

    <!-- Footer with branch info -->
    <div style="padding: 8px 12px;" class="flex items-center">
      <GitBranch
        size={14}
        style="color: var(--color-fg-muted); flex-shrink: 0;"
      />
      <span
        style="font-size: 12px; color: var(--color-fg-muted); margin-left: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
      >
        {workspaceStore.currentBranch}
      </span>
    </div>

    <!-- Right edge separator -->
    <div
      style="position: absolute; top: 0; right: 0; bottom: 0; width: 1px; background: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.06) 10%, rgba(0,0,0,0.06) 90%, transparent 100%);"
    ></div>

    <!-- Resizer handle -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={180}
      aria-valuemax={400}
      tabindex={0}
      onmousedown={handleMouseDown}
      ondblclick={() => {
        width = 220;
      }}
      onkeydown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          const next = width - step;
          if (next < 120) {
            uiStore.setSidebarCollapsed(true);
          } else {
            width = Math.max(180, next);
          }
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          width = Math.min(400, width + step);
        } else if (e.key === "Home") {
          e.preventDefault();
          width = 180;
        } else if (e.key === "End") {
          e.preventDefault();
          width = 400;
        }
      }}
      style="position: absolute; top: 0; right: -4px; bottom: 0; width: 8px; cursor: col-resize; z-index: 10;"
    ></div>
  </div>
{/if}
