<script lang="ts">
  import type { QueueItem } from "../../stores/types";

  // ── Props ──────────────────────────────────────────────────────────────────
  interface Props {
    items: QueueItem[];
    working?: boolean;
    onRemove: (id: string) => void;
    onEdit: (id: string, content: string) => void;
    onClearAll: () => void;
  }

  let {
    items,
    working = false,
    onRemove,
    onEdit,
    onClearAll,
  }: Props = $props();

  // ── Panel collapse state ───────────────────────────────────────────────────
  // User-controlled only — never auto-set by effects.
  let expanded = $state(true);

  function toggleExpanded() {
    expanded = !expanded;
  }

  function handleToggleKey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleExpanded();
    }
  }

  // ── Selection state ────────────────────────────────────────────────────────
  // selectedId tracks which row is expanded. Only one at a time.
  // Clicking the same row again collapses it (sets to null).
  let selectedId = $state<string | null>(null);

  // When `working` becomes true, auto-expand the first item so the user
  // immediately sees what's "next up". When `working` becomes false we leave
  // the selection as-is — the user may still want to inspect it.
  $effect(() => {
    if (working && items.length > 0) {
      selectedId = items[0]!.id;
    }
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function toggleRow(id: string) {
    selectedId = selectedId === id ? null : id;
  }

  function handleEdit(e: MouseEvent, item: QueueItem) {
    e.stopPropagation();
    // Capture id and content at click-time so the callback carries the item's
    // data even if the queue drains concurrently before the parent processes it.
    onEdit(item.id, item.content);
  }

  function handleRemove(e: MouseEvent, id: string) {
    e.stopPropagation();
    // If the removed item was selected, clear selection.
    if (selectedId === id) selectedId = null;
    onRemove(id);
  }

  function handleRowKey(e: KeyboardEvent, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleRow(id);
    }
  }
</script>

<!--
  Renders nothing when the queue is empty — no layout impact, composer stays
  in the same position. Matches the `return null` on empty in the design spec.
-->
{#if items.length > 0}
  <div
    class="w-full"
    style="max-width: 760px; margin: 0 auto;"
    aria-label="Queued messages"
  >
    <!-- Segmented card: single border wrapping all rows with internal dividers -->
    <div
      class="relative overflow-hidden rounded-[12px] border border-border-default bg-bg-elevated shadow-[var(--shadow-sm)]"
    >
      <!-- Header strip: toggle region · spacer · clear all -->
      <div
        class="flex items-center gap-2 px-3 py-2 {expanded
          ? 'border-b border-border-default'
          : ''}"
      >
        <!-- Left toggle region: status dot · count · hint · caret -->
        <div
          role="button"
          tabindex="0"
          aria-expanded={expanded}
          aria-controls="queued-messages-list"
          class="flex min-w-0 flex-1 cursor-default items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus"
          onclick={toggleExpanded}
          onkeydown={handleToggleKey}
        >
          <!-- Status dot: warning amber when working, muted otherwise -->
          <span
            class="h-[6px] w-[6px] shrink-0 rounded-full {working
              ? 'bg-warning'
              : 'bg-fg-disabled'}"
            aria-hidden="true"
          ></span>

          <span
            class="font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase leading-none tracking-[0.06em] text-fg-muted"
          >
            Queued · {items.length}
          </span>

          {#if working}
            <span
              class="text-[11px] text-fg-disabled font-[family-name:var(--font-ui)]"
            >
              sends after current turn
            </span>
          {/if}

          <!-- Caret: rotates 90deg when expanded (pointing down), 0deg when collapsed (pointing right) -->
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            class="ml-[1px] shrink-0 text-fg-disabled transition-transform duration-150 {expanded
              ? 'rotate-90'
              : 'rotate-0'}"
          >
            <path
              d="M6 3l5 5-5 5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>

        <button
          type="button"
          title="Clear queue"
          class="rounded-[4px] px-[4px] py-[2px] font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.03em] text-fg-disabled transition-colors duration-[var(--duration-quick)] hover:text-fg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus"
          onclick={onClearAll}
        >
          Clear all
        </button>
      </div>

      {#if expanded}
        <!-- Scrollable row list, capped at ~170px (~3 visible rows) -->
        <ul
          id="queued-messages-list"
          class="m-0 list-none overflow-y-auto p-0"
          style="max-height: 170px;"
        >
          {#each items as item, i (item.id)}
            {@const isSelected = selectedId === item.id}
            {@const isFailed = item.failed === true}
            <li
              class="{i > 0 ? 'border-t border-border-default' : ''} {isFailed
                ? 'border-l-2 border-l-error/50'
                : ''}"
            >
              <!-- Each row is a grid: 28px index / 1fr preview / auto gutter -->
              <div
                role="button"
                tabindex="0"
                class="grid w-full cursor-default gap-[10px] px-[12px] py-[10px] text-left transition-colors duration-[var(--duration-quick)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-focus {isSelected
                  ? 'bg-bg-selected'
                  : 'hover:bg-bg-hover'}"
                style="grid-template-columns: 28px 1fr auto;"
                aria-label="Queued message {i + 1} of {items.length}{isFailed
                  ? ' — failed'
                  : ''}"
                aria-expanded={isSelected}
                onclick={() => toggleRow(item.id)}
                onkeydown={(e) => handleRowKey(e, item.id)}
              >
                <!-- Index — 2-digit mono, dimmer when not selected or failed -->
                <span
                  class="pt-[2px] font-[family-name:var(--font-mono)] text-[10.5px] font-medium leading-none tracking-[0.02em] {isFailed
                    ? 'text-error'
                    : isSelected
                      ? 'text-fg-default'
                      : 'text-fg-disabled'}"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>

                <!-- Preview text: truncated when collapsed, full when expanded -->
                <span
                  class="min-w-0 text-[12.5px] leading-[1.5] {isSelected
                    ? 'break-words whitespace-normal text-fg-heading'
                    : 'truncate whitespace-nowrap text-fg-default'} {isFailed
                    ? 'text-error'
                    : ''}"
                >
                  {item.content}
                </span>

                <!-- Action gutter: stopPropagation so clicks don't toggle row -->
                <div
                  class="flex items-center gap-[2px]"
                  onclick={(e) => e.stopPropagation()}
                  role="presentation"
                >
                  <!-- Edit — pulls item back into the composer -->
                  <button
                    type="button"
                    title="Edit — pull back into composer"
                    aria-label="Edit queued message: {item.content}"
                    class="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-fg-disabled transition-colors duration-[var(--duration-quick)] hover:bg-bg-hover hover:text-fg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus"
                    onclick={(e) => handleEdit(e, item)}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M11 2.5l2.5 2.5L5.5 13H3v-2.5L11 2.5z"
                        stroke="currentColor"
                        stroke-width="1.4"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </button>

                  <!-- Remove -->
                  <button
                    type="button"
                    title="Remove from queue"
                    aria-label="Remove queued message: {item.content}"
                    class="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-fg-disabled transition-colors duration-[var(--duration-quick)] hover:bg-bg-hover hover:text-fg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus"
                    onclick={(e) => handleRemove(e, item.id)}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M4 4l8 8M12 4l-8 8"
                        stroke="currentColor"
                        stroke-width="1.4"
                        stroke-linecap="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </li>
          {/each}
        </ul>

        <!-- Soft bottom fade when more than 3 items overflow the card -->
        {#if items.length > 3}
          <div
            class="pointer-events-none absolute inset-x-0 bottom-0 h-[24px]"
            style="background: linear-gradient(to bottom, transparent 0%, var(--color-background-card) 100%);"
            aria-hidden="true"
          ></div>
        {/if}
      {/if}
    </div>
  </div>
{/if}
