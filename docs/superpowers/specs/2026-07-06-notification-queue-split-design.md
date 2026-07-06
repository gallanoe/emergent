# Splitting the queue: user messages vs. notifications

**Date:** 2026-07-06
**Status:** Approved design — ready for implementation plan
**Area:** `crates/emergent-core` (agent queue + prompt loop), `emergent-protocol`, `src-tauri` bridge, Svelte frontend (chat)

## Summary

Today a single per-thread queue holds three kinds of pending messages — the
user's own sends, task lifecycle notifications, and inter-thread messages — and
**all** of them render in one editable panel docked above the composer. We are
splitting that presentation in two:

- **User messages** stay in the composer's queue panel (editable, reorderable) —
  already implemented.
- **Notifications** (task + inter-thread messages) move **out** of the composer
  and render in the **scrolling transcript** as read-only blocks the user cannot
  modify — as a pending zone at the tail while waiting, then settled in place once
  the agent consumes them.

The backend queue is **not** physically split. It already tags every item with a
`MessageSource`; the "split" is a rendering + semantics change, plus one new
structured event so a consumed notification can settle into history without
masquerading as a user message.

## Goal / non-goals

**Goals**

- Notifications render in the transcript, read-only, using the **Rail** treatment
  from the design mock-up (`~/Documents/emergent-design`, "Notifications
  Scratchboard" / `em-notifications.jsx`).
- A notification is visually **pending** while queued and **submitted/settled**
  once the agent has read it, distinguished by a **dashed + dimmed** (pending) vs.
  **solid + full-opacity** (submitted) rendering — no separate header chrome.
- Consumed notifications never render as a user bubble within a live session.
- Settled notifications survive closing/reopening a thread within an app session.

**Non-goals (explicitly deferred)**

- No cross-restart persistence/recovery for settled notifications. After an app
  restart + agent revive, notifications fall back to today's behavior (folded into
  the replayed user turn). See [Persistence & rehydration](#persistence--rehydration).
- No physical split of the backend queue into two data structures.
- No change to what the agent actually receives in its prompt.

## Background: how things work today

### The backend queue

`crates/emergent-core/src/agent/queue.rs` — one `ThreadQueue` per thread, owned by
`ThreadManager` and keyed by `thread_id` (outlives the live process, so a dormant
thread's queue holds messages until it resumes). Each `QueuedMessage` carries a
`MessageSource`:

```rust
enum MessageSource {
    User,                                         // user-typed prompt
    Task   { task_id: String, kind: String },     // task lifecycle notification
    Thread { from_thread_id: String, from_name: String }, // send_message MCP tool
}
```

`QueuedMessage::render()` produces the agent-facing text: `User` is bare; `Task`
gets a `[task {kind}]` header; `Thread` gets a `[message from {name}]` header.

### Drain / coalesce

`crates/emergent-core/src/agent/prompt_loop.rs` waits on the queue's `Notify`,
then `drain_all()` pulls the **entire** queue in one shot and coalesces every
message (all sources) into a single turn: `messages.map(render).join("\n\n")`,
prefixed with the system block. It emits an empty `QueueChanged` so the composer
chip stack clears, then sends the coalesced text to the agent.

### How a drained turn reaches the transcript (the echo)

The manager never pushes the drained user turn to the transcript directly.
Instead the ACP agent **echoes** the prompt back as a `UserMessageChunk`;
`acp_bridge.rs` tags the first chunk of a manager-initiated turn `is_echo=true`
and emits `Notification::UserMessage { is_echo }`. On the frontend
(`agents.svelte.ts::handleUserMessage`):

- `is_echo=true` + an in-flight optimistic bubble (idle send) → flip it
  `sending=false` and return.
- `is_echo=true` + no optimistic bubble (busy/queued send) → push the coalesced
  text as a new user bubble.

**Consequence:** because the coalesced text includes the `[task …]` /
`[message from …]` headers, a consumed notification currently lands in the
transcript **inside a user bubble**. This is the wart we are removing.

### History & rehydration (the persistence question)

- `threads.json` (`PersistedWorkspaceState`) persists **only** `ThreadMapping`
  (`thread_id`, `agent_definition_id`, `acp_session_id`, `task_id`) + usage
  totals. **The transcript is never written to disk.**
- A background recorder task in `ThreadManager::new` appends **every** broadcast
  `Notification` that has a `thread_id()` into an in-memory
  `HashMap<thread_id, Vec<Notification>>` (generic — no per-variant whitelist).
- **Within an app session**, reopening a thread calls `get_history` →
  `agents.svelte.ts::replayNotifications`, which rebuilds the transcript from that
  in-memory log.
- **Across an app restart**, the in-memory log is gone. `resume_thread` performs
  an ACP `session/load` with the stored `acp_session_id`; the agent **replays its
  own session** as fresh `SessionUpdate` events (arriving `is_echo=false`), which
  repopulate the transcript.

This two-path model is why cross-restart survival of settled notifications would
require a new subsystem: our synthetic events live in path 1 (recorded log) but
not in path 2 (ACP session replay).

## Design decisions (resolved forks)

| Decision                          | Choice                                                                                   | Rationale                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Where do notifications render?    | Scrolling transcript, read-only                                                          | User requirement; composer stays user-only/editable                                               |
| Post-consumption behavior         | **Settle in place** — permanent read-only block in history, never a user bubble          | Faithful to the mock-up's "never as a user bubble"                                                |
| Visual treatment                  | **Rail** for both pending and settled                                                    | User choice                                                                                       |
| Pending vs. submitted distinction | **Dashed + dimmed** (pending) vs. **solid + full-opacity** (submitted); no header chrome | Updated mock (2026-07-06) — per-message state, quieter than a "Queued · N" header                 |
| Backend queue                     | **One** source-tagged queue (not split)                                                  | Agent must receive all sources coalesced in one turn; source tag already enables the render split |
| Consumed-turn rendering mechanism | **New `TurnDispatched` structured event** (drop `is_echo=true` rendering)                | Clean separation of user text vs. notifications; avoids fragile string-stripping of the echo      |
| Cross-restart survival            | **Graceful degradation**, no persistence                                                 | Strictly better than today within a session; a recovery system is its own project                 |

## Architecture

The change is a **rendering + semantics split**, not a data-structure split.

```
                 ┌───────────────── ThreadQueue (unchanged, source-tagged) ─────────────────┐
   enqueue  ───► │  User          Task{..}          Thread{..}   …                           │
                 └───────────────────────────────┬───────────────────────────────────────────┘
                                                 │ prompt_loop drain_all() (coalesce for agent)
                                                 ▼
                        split by source ──►  user_text (bare)   +   notifications[] (task/thread)
                                                 │                        │
                        emit Notification::TurnDispatched { thread_id, user_text, notifications }
                                                 │
   FRONTEND:                                     ▼
   • pending mirror (pendingQueue)      handle TurnDispatched:
       ├─ user  → composer queue          • push settled Rail blocks (role "notification")
       └─ task/thread → tail Rails        • push/reconcile user bubble from user_text only
                                          • is_echo=true UserMessage → ignored
```

### Pending state (before consumption)

The existing `pendingQueue` mirror (already source-tagged, driven by
`QueueChanged`) is split into two **derived** views:

- `composerQueue` = items with `source === "user"` → passed to the composer's
  `QueuedMessages.svelte` (editable, as today).
- `notificationQueue` = items with `source === "task" | "thread"` → rendered as
  **pending (dashed + dimmed) Rail** blocks at the transcript tail in
  `ChatArea.svelte`.

No backend change is needed for the pending split — it is pure frontend filtering.

### Consumed state (settle in place)

`prompt_loop`, at drain time, partitions the drained batch:

- `user_text: Option<String>` — coalesced `User` messages, rendered bare, **no
  system block, no notification text**. `None` if the batch had no user messages.
- `notifications: Vec<QueuedMessageView>` — the `Task`/`Thread` items that were
  drained.

It emits `Notification::TurnDispatched { thread_id, user_text, notifications }`
**before** sending the coalesced prompt to the agent (so it arrives ahead of the
agent's echo). The agent still receives the full coalesced text — agent-facing
behavior is unchanged.

The frontend `TurnDispatched` handler:

1. Appends each notification as a **submitted (solid, full-opacity) Rail** block —
   `DisplayMessage { role: "notification", … }` — in list order, woven inline at
   the consumption point between the prior and next turns.
2. If `user_text` is present: reconcile an in-flight optimistic bubble
   (`sending=false`) if one exists, else push a user bubble containing
   `user_text` only.
3. The subsequent `is_echo=true` `UserMessage` is **ignored** (the structured
   event is now the authoritative source for drained turns).

**Ordering rule:** on `TurnDispatched`, append notification blocks first, then the
user bubble (busy/queued path). For the idle path the optimistic user bubble
already exists above; it is reconciled in place. The rare mixed case (user text +
notifications in the same drain) may therefore order user-then-notifications for
an idle send vs. notifications-then-user for a queued send — acceptable cosmetic
variance, not worth extra machinery.

### Authoritative rule for the echo

> In **both** live handling and within-session replay, a `UserMessage` with
> `is_echo=true` is ignored. `TurnDispatched` is the sole source for rendering a
> drained turn. `is_echo=false` user messages (spontaneous, and the post-restart
> ACP replay) are still pushed normally.

This single rule prevents double-rendering (the recorded log contains both the
`TurnDispatched` event and the `is_echo=true` `UserMessage`).

## Visual language

One reusable `NotificationRail.svelte` (per mock-up V2 "Rail"), driven by a
`state: "pending" | "submitted"` prop:

- **Left rail (2px, neutral `border-l-border-strong` in both states):** `dashed`
  when `pending`, `solid` when `submitted`
  (`border-l-2 border-dashed` → `border-solid`).
- **Opacity:** the whole block is dimmed (~`0.68`) while `pending`, full opacity
  once `submitted` — the "in-flight" look.
- **Header row:** source icon · label · (task status glyph) · jump action.
  - `thread` source → agent avatar + sender name (no "message" label).
  - `task` source → checklist glyph + `task_id` + status glyph
    (completed = green check, failed = red cross, unblocked/ready = amber dot).
- **Body:** the message text.
- **Jump action:** "View thread" (thread source) / "Open task" (task source),
  wired to the existing thread-select / task-detail navigation.

The same component renders pending Rails (from `notificationQueue`, `state="pending"`)
and submitted Rails (from `role: "notification"` messages, `state="submitted"`).

Note: the task status glyph (green/red/amber) is **independent** of the pending/
submitted state — it reflects the task outcome and shows in both states. Only the
rail style (dashed → solid) and opacity change on submission.

## Data model changes

### `emergent-protocol` (`src/types.rs`)

Extend the existing wire view so pending **and** settled Rails can render task
metadata (currently `QueuedMessageView` lacks `task_id` / status):

```rust
pub struct QueuedMessageView {
    pub id: String,
    pub source: String,                 // "user" | "task" | "thread"
    pub from: Option<String>,           // thread sender name
    pub task_id: Option<String>,        // NEW — task source
    pub task_status: Option<String>,    // NEW — from MessageSource::Task.kind
    pub content: String,
    pub created_at: String,
}

pub struct TurnDispatchedPayload {
    pub thread_id: String,
    pub user_text: Option<String>,          // coalesced user text only (no system block / notifications)
    pub notifications: Vec<QueuedMessageView>, // task/thread items drained this turn
}

// New Notification variant; Notification::thread_id() must return its thread_id
// so the recorder logs it.
Notification::TurnDispatched(TurnDispatchedPayload)
```

Reusing `QueuedMessageView` for both the pending mirror and the consumed list
keeps one type for both Rail states.

### `queue.rs`

`QueuedMessage::view()` populates the new `task_id` / `task_status` fields from
`MessageSource::Task { task_id, kind }`. Add a helper to partition a drained
`Vec<QueuedMessage>` into `(user_text: Option<String>, notifications: Vec<QueuedMessageView>)`.

### Frontend (`src/stores/types.ts`)

```ts
// DisplayMessage.role gains "notification"; add fields it needs:
interface DisplayMessage {
  role: "assistant" | "thinking" | "user" | "tool-group" | "system" | "nudge" | "notification";
  // …existing…
  source?: "task" | "thread";
  from?: string;
  taskId?: string;
  taskStatus?: "completed" | "failed" | "ready";
}

interface TurnDispatchedPayload {
  thread_id: string;
  user_text: string | null;
  notifications: QueuedMessageView[];
}
```

`notifications` reuses the existing `QueuedMessageView` (extended with
`task_id`/`task_status`) — no separate consumed-notification type.

**Task status mapping.** `QueuedMessageView.task_status` is derived on the backend
from `MessageSource::Task.kind`. The frontend maps it to a status glyph:
`completed` → green check, `failed` → red cross, `ready`/`unblocked` → amber dot.
Any unrecognized kind falls back to the neutral/completed glyph (mirroring the
mock-up's `N_TASK_STATUS[status] || N_TASK_STATUS.completed`). The exact set of
`kind` strings emitted by task subscribers must be confirmed against
`task/mod.rs::notify_subscribers` during implementation and the mapping aligned.

## Backend changes (files)

- **`crates/emergent-core/src/agent/queue.rs`** — add `task_id`/`task_status` to
  `view()`; add a `partition_for_dispatch()`-style helper returning
  `(Option<String>, Vec<QueuedMessageView>)`.
- **`crates/emergent-core/src/agent/prompt_loop.rs`** — after `drain_all()`,
  partition the batch, emit `Notification::TurnDispatched` before sending the
  coalesced prompt to the agent. The agent prompt is still built from
  `system_block + coalesced_all_sources` (unchanged).
- **`crates/emergent-protocol/src/types.rs`** — new `TurnDispatchedPayload`,
  extended `QueuedMessageView`, new `Notification::TurnDispatched` + `thread_id()` arm.
- **`src-tauri/src/lib.rs`** — bridge arm mapping `Notification::TurnDispatched`
  to the Tauri event `thread:turn-dispatched`.

## Frontend changes (files)

- **`src/stores/types.ts`** — types above; extend `QueuedMessageView`.
- **`src/stores/agents.svelte.ts`**
  - `handleTurnDispatched(payload)`: push settled notification blocks +
    push/reconcile user bubble; register listener for `thread:turn-dispatched`.
  - `handleUserMessage`: **ignore `is_echo=true`** (return without pushing).
  - `replayNotifications`: add a `thread:turn-dispatched` arm mirroring the live
    handler; ensure it also skips `is_echo=true` `UserMessage` records.
  - Derive/expose `composerQueue` (user) and `notificationQueue` (task/thread)
    from `pendingQueue`.
- **`src/stores/app-state.svelte.ts`** — expose `selectedThreadNotificationQueue`
  (and keep `selectedThreadPendingQueue` returning user-only for the composer),
  or repoint the composer to the user-only view.
- **`src/components/chat/NotificationRail.svelte`** — new; `state:
"pending" | "submitted"` prop drives rail style (dashed → solid) + opacity;
  renders header/body/jump action per source.
- **`src/components/chat/ChatArea.svelte`** — render `role: "notification"`
  blocks inline (settled Rails); append `notificationQueue` pending Rails at the
  tail, before the bottom spacer.
- **`src/components/chat/ChatInput.svelte`** — receive user-only `composerQueue`.
- **`src/components/chat/QueuedMessages.svelte`** — remove the read-only
  "task-notification" branch; the panel is now purely user/editable.
- **`src/App.svelte`** — pass `notificationQueue` down to `ChatArea`, user-only
  queue to `ChatInput`.

## Data flow summary

1. **Notification arrives** (task subscriber or `send_message`) → enqueued
   (source-tagged) → `QueueChanged` → mirror updates → pending (dashed + dimmed)
   Rail at the transcript tail.
2. **Agent's next turn** → `prompt_loop` drains → emits `TurnDispatched` →
   frontend converts each notification to a submitted (solid) Rail woven inline in
   history + renders the user bubble (user text only); empty `QueueChanged` clears
   the pending tail.
3. **Reopen thread, same session** → `get_history` → `replayNotifications`
   replays the recorded `TurnDispatched` → settled Rails rebuilt identically.
4. **App restart + revive** → ACP `session/load` replays the agent's session;
   `TurnDispatched` is absent → the notification text returns folded into the
   replayed (`is_echo=false`) user turn = today's behavior (graceful fallback).

## Persistence & rehydration

Accepted degradation, no new persistence:

- **Survives:** live session, thread dormancy, close/reopen (recorded log +
  `replayNotifications`).
- **Does not survive:** full app restart — falls back to today's inline
  rendering. This is strictly not worse than current behavior (today
  notifications are _always_ inline in a user bubble).
- Building cross-restart survival (persist settled notifications, merge on revive,
  strip duplicated text from replayed prompts) is deferred as a separate project.

## Edge cases

- **Idle live agent:** an inbound notification enqueues then drains almost
  immediately → brief dashed/dimmed flash at the tail, then settles solid.
  Acceptable.
- **Empty `user_text`:** notification-only turn → settled Rails, no user bubble.
- **Permission-change / first-turn / task-session turns:** all route through
  `prompt_loop`, so `TurnDispatched` fires for them too (possibly with empty
  `user_text` and empty notifications) — the handler must no-op cleanly when both
  are empty.
- **`QueueChanged` vs. drain ordering:** `TurnDispatched` and the empty
  `QueueChanged` both fire at drain; the pending tail clears from `QueueChanged`
  while settled blocks appear from `TurnDispatched`. Both derive from the same
  drained batch, so no gap/flicker of duplicated content.
- **Recorded log double-source:** the recorder logs both `TurnDispatched` and the
  `is_echo=true` `UserMessage`; the "ignore `is_echo=true`" rule in
  `replayNotifications` prevents double-render.

## Testing plan

**Rust (`cargo test --workspace`)**

- `prompt_loop` emits `TurnDispatched` with the correct `(user_text,
notifications)` split for: user-only, notification-only, and mixed drains.
- The agent-facing coalesced prompt is unchanged (still includes rendered
  notifications).
- `QueuedMessage::view()` populates `task_id`/`task_status` for `Task` source.
- `Notification::TurnDispatched.thread_id()` returns the thread id (so the
  recorder logs it) — assert it lands in `get_history`.

**Frontend unit (Vitest)**

- `handleTurnDispatched`: settled notification blocks appended; user bubble from
  `user_text` only (no `[task …]` text); idle-optimistic bubble reconciled.
- `handleUserMessage` ignores `is_echo=true`; still pushes `is_echo=false`.
- `replayNotifications` rebuilds settled Rails from a recorded `TurnDispatched`
  and skips the paired `is_echo=true` record (no duplication).
- Derived `composerQueue` / `notificationQueue` partition by source.
- `QueuedMessages` renders only user items (no task-notification branch).

**Component**

- `NotificationRail` renders dashed + dimmed (pending) vs. solid + full-opacity
  (submitted); task vs. thread header variants; status glyphs unaffected by state.
- `ChatArea` shows pending Rails at the tail and settled Rails inline; jump
  actions invoke navigation.

## Open implementation notes

- Confirm the exact Tauri event name convention used by the `lib.rs` bridge and
  the frontend replay union tag (`thread:turn-dispatched`) match.
- Decide whether `app-state` exposes a new `notificationQueue` selector or the
  composer selector is narrowed to user-only (either works; pick the smaller diff).
