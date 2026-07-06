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

**Emission point (accept-gated, ordering-correct).** `TurnDispatched` is emitted
inside `prompt_loop` **Phase 3, immediately after `command_tx.send(AgentCommand::
Prompt{…})` returns `Ok`** — i.e. once the command has been accepted into the ACP
command loop of a live thread — and **before** awaiting the turn's reply (so it is
recorded ahead of the assistant's streamed chunks; see [Replay ordering](#replay-ordering-within-a-session)).
This gates the settled blocks on the thread actually being alive and accepting the
prompt, which resolves the "settled-but-never-received" failure mode: if
`command_tx.send` returns `Err` (thread terminated), **no `TurnDispatched` is
emitted** and the drained batch is lost with the thread going `Error` — the exact
same loss semantics the current code already has for a failed user send (the queue
is drained before the send in today's code). The agent still receives the full
coalesced text; agent-facing behavior is unchanged.

> **Semantics of "submitted":** a notification is _submitted_ once it has been
> **dispatched into an accepted agent turn**, not once the turn _completes_. A turn
> that errors after acceptance still leaves its notifications submitted (their
> content was delivered); the thread's `Error` status is the separate signal that
> the turn did not finish. We deliberately do **not** emit on turn-completion,
> because that would place the settled blocks _after_ the assistant's streamed
> response instead of before it (wrong transcript order).

The frontend `TurnDispatched` handler, in this fixed order:

1. Appends each notification as a **submitted (solid, full-opacity) Rail** block —
   `DisplayMessage { role: "notification", … }`, keyed by the notification's
   queue `id` — in list order, woven inline at the consumption point.
2. **Then** renders the user bubble (if `user_text` is present): if an in-flight
   optimistic bubble exists (idle send), **re-anchor it below the notification
   blocks** and clear `sending`; otherwise push a new user bubble containing
   `user_text` only.
3. The paired `is_echo=true` `UserMessage` is **ignored** (see the authoritative
   rule below).

**Canonical order = notifications, then user bubble.** Step 2 re-anchors the
optimistic idle bubble so the order is identical on both the idle and busy/queued
paths (Codex flagged the earlier "accepted variance" as a weak transcript model;
re-anchoring removes it). Re-anchoring is safe — same content, same thread.

### Authoritative rule for the echo

> In **both** live handling and within-session replay, a `UserMessage` with
> `is_echo=true` is ignored. `TurnDispatched` is the sole source for rendering a
> drained turn. `is_echo=false` user messages (spontaneous, and the post-restart
> ACP replay) are still pushed normally.

This single rule prevents double-rendering: the recorded in-memory log contains
**both** the `TurnDispatched` event and the `is_echo=true` `UserMessage`, so replay
would otherwise render the turn twice.

**Two code paths must both change** — this is easy to half-implement:

- `agents.svelte.ts::handleUserMessage` (live, ~L384) — already branches on
  `is_echo`; change the `is_echo=true` branch to return without pushing (it may
  still reconcile an optimistic bubble's `sending` flag, but `TurnDispatched` now
  owns that too, so reconciliation can move entirely to the `TurnDispatched`
  handler).
- `agents.svelte.ts::replayNotifications` (~L898) — currently pushes
  `thread:user-message` **unconditionally, with no `is_echo` check**. It must skip
  `is_echo=true` records and handle the new `thread:turn-dispatched` record with
  the same logic as the live handler.

Note the two paths are otherwise disjoint: within-session reopen uses
`replayNotifications` over the recorded log (which has `TurnDispatched`);
post-restart revive uses the **live** ACP-replay handlers (`is_echo=false`, no
`TurnDispatched`) — the graceful-degradation fallback.

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
  - `task` source → checklist glyph + `task_id` + status glyph, mapped from the
    **actual** subscriber `kind` (see [Task notification vocabulary](#task-notification-vocabulary-real-kinds--gap)):
    `completed` = green check; `started` / `update` = neutral in-progress dot
    (no status color). The component also supports `failed` (red cross) and
    `ready`/`unblocked` (amber dot) for forward-compat, but those kinds are **not
    emitted today**.
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
  // Real emitted kinds today: "started" | "update" | "completed".
  // "failed" | "ready" are supported by the component but not emitted (see below).
  taskStatus?: "started" | "update" | "completed" | "failed" | "ready";
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
from `MessageSource::Task.kind`. See the next section for the real kinds and the
gap.

## Task notification vocabulary (real kinds + gap)

Codex's review corrected a speculative assumption in the first draft. The task
subscriber (`crates/emergent-core/src/task/mod.rs::notify_subscribers`) emits
exactly three kinds today:

| `kind`      | Emitted by                                 | Rail status glyph       |
| ----------- | ------------------------------------------ | ----------------------- |
| `started`   | `start_task` (incl. unblocked tasks; L790) | neutral in-progress dot |
| `update`    | `post_update` (L484)                       | neutral in-progress dot |
| `completed` | `complete_task` (L421)                     | green check             |

Notably **not emitted**:

- **`failed`** — `fail_task` (L434) does **not** call `notify_subscribers`, so a
  failed task never enqueues a notification.
- **`ready` / `unblocked`** — there is no distinct "became unblocked" kind; an
  unblocked task is simply _started_ (`start_unblocked_tasks` → `start_task` →
  `"started"`), so it arrives as `started`, not a dedicated unblock signal.

**Decision for this feature:** the `NotificationRail` component renders all five
statuses (so the mock's full vocabulary is available), but the mapping only
promises `started` / `update` / `completed` from real data. Unknown kinds fall
back to the neutral in-progress glyph. Whether to also emit `failed` (a one-line
`notify_subscribers` call in `fail_task`) and/or an unblock signal is a **scope
decision surfaced to the user** — it is a small but separate backend change and is
what makes the red/amber states in the mock actually appear. It is **out of scope
for this spec unless explicitly pulled in.**

## Backend changes (files)

- **`crates/emergent-core/src/agent/queue.rs`** — add `task_id`/`task_status` to
  `view()`; add a `partition_for_dispatch()`-style helper returning
  `(Option<String>, Vec<QueuedMessageView>)`.
- **`crates/emergent-core/src/agent/prompt_loop.rs`** — after `drain_all()`,
  partition the batch; emit `Notification::TurnDispatched` in **Phase 3, in the
  `Ok(())` arm right after `command_tx.send(Prompt)` succeeds, before awaiting the
  reply** (accept-gated + ordered ahead of the assistant's chunks — see
  [Emission point](#consumed-state-settle-in-place)). Do **not** emit in the `Err`
  arm. The agent prompt is still built from `system_block +
coalesced_all_sources` (unchanged).
- **`crates/emergent-core/src/agent/queue.rs` + the queue mutation commands** —
  make composer-driven mutations **user-source-scoped** (see
  [Composer queue operations](#composer-queue-operations-after-the-split)):
  `clear` clears only `User` items; `reorder` reorders only among `User` items and
  leaves `Task`/`Thread` items in place. `remove`/`edit` stay id-based (already
  safe since the composer only holds user ids).
- **`crates/emergent-protocol/src/types.rs`** — new `TurnDispatchedPayload`,
  extended `QueuedMessageView`, new `Notification::TurnDispatched` + `thread_id()` arm.
- **`src-tauri/src/lib.rs`** — bridge arm mapping `Notification::TurnDispatched`
  to the Tauri event `thread:turn-dispatched` (the bridge already exhaustively
  matches every `Notification` variant and emits by `event_name()`, so this is one
  new arm + `event_name()` case).

## Frontend changes (files)

- **`src/stores/types.ts`** — types above; extend `QueuedMessageView`; add
  `{ type: "thread:turn-dispatched" } & TurnDispatchedPayload` to the
  `DaemonNotification` replay union (currently missing this and `queue-changed`).
- **`src/stores/agents.svelte.ts`**
  - `handleTurnDispatched(payload)`: push settled notification blocks (keyed by
    queue `id`), then render/re-anchor the user bubble (notifications-first
    canonical order); register listener for `thread:turn-dispatched`.
  - `handleUserMessage`: **ignore `is_echo=true`** (return without pushing;
    reconciliation moves to `handleTurnDispatched`).
  - `replayNotifications` (~L898): add a `thread:turn-dispatched` arm mirroring the
    live handler **and** change the `thread:user-message` arm to skip
    `is_echo=true` records (today it pushes unconditionally).
  - Derive/expose `composerQueue` (user) and `notificationQueue` (task/thread)
    from `pendingQueue`.
  - Composer mutation wrappers (`clearQueue`, `removeQueueItem`, edit, reorder)
    operate on user items only — see
    [Composer queue operations](#composer-queue-operations-after-the-split).
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

## Composer queue operations after the split

The composer now shows only `User` items, but the backend queue still holds all
sources interleaved. Composer-driven mutations must therefore be **user-scoped** so
they can't reach the hidden `Task`/`Thread` items:

- **Remove / Edit** — already `id`-based, and the composer only ever holds user
  ids, so these are safe as-is.
- **Clear all** — must clear **only `User`-source items**; task/thread items are
  read-only in the transcript and were never user-clearable. Backend `ThreadQueue::
clear` becomes source-filtered (or a `clear_user()` variant); the `clear_queue`
  command uses it.
- **Reorder** — must reorder **only among `User` items**, leaving `Task`/`Thread`
  items in their queue positions. (Today's `reorder(ids)` appends any un-named item
  to the end, so passing only user ids would shove notifications to the back and
  change the coalesced-prompt order.) Make the backend reorder source-aware.

The relative order of `Task`/`Thread` vs `User` items in the _agent-facing
coalesced prompt_ is unaffected by these — only user-item ordering is user-editable.

## Replay ordering within a session

Because `TurnDispatched` is emitted **before** the turn's assistant chunks stream
(Phase 3, pre-reply), it is recorded in the in-memory log _ahead_ of those chunks.
`replayNotifications` walks the log in order, so on reopen the settled Rails land
in the same position relative to tool calls, system messages, and assistant
content as they did live. (This is a second reason the emission point is pre-reply,
not on turn completion.)

## Compatibility

The Tauri app is a **single binary** — frontend and backend ship together, so
there is no cross-version event mismatch to guard against. The `QueuedMessageView`
additions (`task_id`, `task_status`) are new `Option` fields (additive; serde-safe
for the in-session recorded log). The recorded in-memory log is never persisted, so
there is no on-disk schema migration. `thread:turn-dispatched` is a brand-new
event; nothing older references it.

## Data flow summary

1. **Notification arrives** (task subscriber or `send_message`) → enqueued
   (source-tagged) → `QueueChanged` → mirror updates → pending (dashed + dimmed)
   Rail at the transcript tail.
2. **Agent's next turn** → `prompt_loop` drains → empty `QueueChanged` clears the
   pending tail → the prompt is accepted by the command loop → `TurnDispatched`
   emitted → frontend converts each notification to a submitted (solid) Rail woven
   inline in history + renders the user bubble (user text only). If the command is
   rejected (dead thread), no `TurnDispatched` fires and the thread goes `Error`.
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
- **A fully-empty `TurnDispatched` cannot occur:** `drain_all()` returns `None`
  (loop waits) when the queue is empty, so any dispatched turn has ≥1 drained
  message — thus at least one of `user_text` / `notifications` is non-empty. The
  handler still guards defensively (no-op if somehow both empty). Permission-change
  / first-turn / task-session system blocks ride along a real drained batch; they
  never produce a standalone empty event.
- **Failed send (accept-gated):** if `command_tx.send(Prompt)` returns `Err`, no
  `TurnDispatched` is emitted; the drained batch (user text + notifications) is
  lost and the thread goes `Error`. This matches today's loss semantics for a
  failed user send. The pending Rails were already cleared by the empty
  `QueueChanged`; the notifications simply do not settle. Rare (dead/killed
  thread), and the `Error` status makes it visible.
- **`id`-keyed reconciliation:** pending Rails come from `notificationQueue`
  (keyed by queue `id`); the empty `QueueChanged` replaces that list wholesale, so
  the pending Rails vanish. Submitted blocks are `DisplayMessage`s carrying the
  **same** notification `id`. Keying both by `id` guarantees a clean
  pending→submitted swap with no duplicate/flicker even if the two events arrive a
  frame apart.
- **Cross-restart inconsistency (accepted):** the same ACP session renders
  notifications as settled Rails before a restart and as inline user-turn text
  after one (graceful degradation). Accepted; documented in
  [Persistence & rehydration](#persistence--rehydration).
- **Broadcast lag (pre-existing):** the recorder/bridge already log
  `broadcast::Receiver` lag without a recovery path; a dropped `TurnDispatched` or
  `QueueChanged` under extreme lag is possible and not separately recovered —
  consistent with every other notification. No new mitigation in scope.

## Testing plan

**Rust (`cargo test --workspace`)**

- `prompt_loop` emits `TurnDispatched` with the correct `(user_text,
notifications)` split for: user-only, notification-only, and mixed drains.
- **Emission is accept-gated:** `TurnDispatched` fires on a successful
  `command_tx.send`, and does **not** fire when the send returns `Err` (dead
  thread) — that path leaves no settled event and sets `Error`.
- The agent-facing coalesced prompt is unchanged (still includes rendered
  notifications).
- `QueuedMessage::view()` populates `task_id`/`task_status` for `Task` source
  from the real kinds (`started`/`update`/`completed`).
- Source-scoped mutations: `clear` removes only `User` items; `reorder` reorders
  only `User` items and preserves `Task`/`Thread` positions.
- `Notification::TurnDispatched.thread_id()` returns the thread id (so the
  recorder logs it) — assert it lands in `get_history`.

**Frontend unit (Vitest)**

- `handleTurnDispatched`: settled notification blocks appended; user bubble from
  `user_text` only (no `[task …]` text); idle-optimistic bubble reconciled **and
  re-anchored below the notifications** (canonical order on both paths).
- `handleUserMessage` ignores `is_echo=true`; still pushes `is_echo=false`.
- `replayNotifications` rebuilds settled Rails from a recorded `TurnDispatched`
  **and** skips the paired `is_echo=true` `thread:user-message` record (no
  duplication) — regression guard for the two-path change.
- Derived `composerQueue` / `notificationQueue` partition by source; composer
  `clearQueue`/reorder only affect user items.
- `QueuedMessages` renders only user items (no task-notification branch).
- `task_status` glyph mapping: `completed`→check, `started`/`update`→neutral,
  unknown→neutral fallback.

**Component**

- `NotificationRail` renders dashed + dimmed (pending) vs. solid + full-opacity
  (submitted); task vs. thread header variants; status glyphs unaffected by state.
- `ChatArea` shows pending Rails at the tail and settled Rails inline; jump
  actions invoke navigation.

## Open implementation notes

- Match the `lib.rs` bridge `event_name()` casing to the frontend replay union tag
  (`thread:turn-dispatched`).
- Decide whether `app-state` exposes a new `notificationQueue` selector or the
  composer selector is narrowed to user-only (either works; pick the smaller diff).

## Open decision for the user

- **Emit `failed` (and/or an unblock) task notification?** The mock's red/amber
  status states never appear today, because `fail_task` doesn't notify subscribers
  and there is no dedicated unblock kind (see
  [Task notification vocabulary](#task-notification-vocabulary-real-kinds--gap)).
  Adding `failed` is ~a one-line `notify_subscribers` call; an unblock signal is a
  bit more. This is a small but real scope addition — **default: out of scope**
  (render only `started`/`update`/`completed`), pull in on request.

## Revision log

- **2026-07-06 — Codex review incorporated.** Codex verified every structural
  claim against the source and flagged: (1) emit `TurnDispatched` only after the
  prompt is accepted by the command loop, with defined failure semantics
  [→ Emission point]; (2) the replay path (`replayNotifications`) must apply the
  same `is_echo` drop rule, not just the live handler [→ Authoritative rule];
  (3) composer queue mutations must be user-scoped [→ Composer queue operations];
  (4) the task `kind` mapping was speculative — real kinds are
  `started`/`update`/`completed`, and `failed`/`unblocked` are not emitted
  [→ Task notification vocabulary]; (5) `id`-keyed reconciliation, canonical
  ordering (re-anchor the idle bubble), the `DaemonNotification` union addition,
  compatibility, and the impossibility of a fully-empty event were all pinned down.
