# Notification Queue Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move task + inter-thread notifications out of the composer's editable queue and render them read-only in the transcript — pending (dashed/dimmed) at the tail, then settled (solid) in place once the agent consumes them — while user messages stay editable in the composer.

**Architecture:** The single source-tagged backend queue is unchanged. A new `TurnDispatched` broadcast event, emitted by `prompt_loop` once a drained turn is accepted by the command loop, carries the split `(user_text, notifications)`. The frontend renders notifications as `role: "notification"` transcript blocks and drops the ACP `is_echo` echo so notifications never render as a user bubble. Pending notifications are a filtered view of the existing queue mirror.

**Tech Stack:** Rust (Tokio, `emergent-core` + `emergent-protocol`), Tauri 2 bridge (`src-tauri`), Svelte 5 runes + TypeScript frontend, Vitest + Testing Library, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-07-06-notification-queue-split-design.md` (read it first).

## Global Constraints

- Rust must pass `clippy -- -D warnings` (warnings = errors). Do **not** run `cargo fmt` — Rust here is hand-formatted; CI only gates prettier + oxfmt.
- Frontend uses Svelte 5 runes (`$state`/`$derived`/`$effect`); stores are `.svelte.ts`. Use `bun`, never `npm`.
- Stage specific files with `git add <path>` — never `git add -A` / `git add .`.
- Pre-commit hook runs `bun run lint`, `bun run lint:rust`, and `bun run fmt:check`. Run `bun run fmt` before committing frontend/markdown changes.
- New wire event name is exactly `thread:turn-dispatched`. New `QueuedMessageView` fields are `Option`/optional (additive; serde-safe).
- The app is a single binary — frontend and backend ship together; no cross-version guards needed.
- Prefer the Bun wrappers or `cargo … -p <crate>` over bare root `cargo` (workspace `default-members = ["crates/*"]` excludes `src-tauri`).

## File Structure

**Backend (Rust)**

- `crates/emergent-protocol/src/types.rs` — extend `QueuedMessageView`; add `TurnDispatchedPayload` + `Notification::TurnDispatched` + `event_name`/`thread_id` arms; unit test.
- `crates/emergent-core/src/agent/queue.rs` — `view()` carries task metadata; new `partition_dispatch()`; source-scoped `clear_user`/`edit`/`remove`/`reorder`; new `#[cfg(test)] mod tests`.
- `crates/emergent-core/src/agent/prompt_loop.rs` — emit `TurnDispatched` in the accept-gated spot.
- `crates/emergent-core/tests/integration.rs` — emission + ordering + `get_history` integration test.
- `src-tauri/src/lib.rs` — one bridge arm for `TurnDispatched` (compile-forced by the exhaustive match).

**Frontend (TS / Svelte)**

- `src/stores/types.ts` — extend `QueuedMessageView`; add `TurnDispatchedPayload`; extend `DisplayMessage`; extend `DaemonNotification` union.
- `src/stores/agents.svelte.ts` — `handleTurnDispatched`, `handleUserMessage` echo-drop, `replayNotifications` arm, listener, `_test` export, `viewToNotification` helper.
- `src/lib/chat-utils.ts` — pure `partitionPendingQueue()` split helper.
- `src/stores/app-state.svelte.ts` — `selectedThreadComposerQueue` / `selectedThreadNotificationQueue` selectors.
- `src/components/chat/NotificationRail.svelte` — the Rail component (pending/submitted).
- `src/components/chat/ChatArea.svelte` — render `role: "notification"` blocks inline + pending Rails at the tail.
- `src/components/chat/QueuedMessages.svelte` — drop the read-only task-notification branch (user-only).
- `src/components/chat/ChatInput.svelte` + `src/App.svelte` — wire composer to `composerQueue`, ChatArea to `notificationQueue`.

**Task order:** backend (1–4) → frontend store (5–7) → frontend UI (8–10). Each task leaves the workspace compiling and all tests green. Notifications become fully visible only at Task 9–10; earlier states preserve today's behavior.

---

### Task 1: Protocol — `TurnDispatched` event + task-metadata on `QueuedMessageView`

**Files:**

- Modify: `crates/emergent-protocol/src/types.rs` (`QueuedMessageView` ~L197; `Notification` enum ~L394; `event_name` ~L440; `thread_id` ~L466; `#[cfg(test)] mod tests` ~L497)
- Modify: `crates/emergent-core/src/agent/queue.rs` (`QueuedMessage::view` ~L75) — forced by the struct change
- Modify: `src-tauri/src/lib.rs` (notification bridge match ~L207) — forced by the exhaustive match
- Test: `crates/emergent-protocol/src/types.rs` (existing `mod tests`)

**Interfaces:**

- Produces: `emergent_protocol::TurnDispatchedPayload { thread_id: String, user_text: Option<String>, notifications: Vec<QueuedMessageView> }`; `Notification::TurnDispatched(TurnDispatchedPayload)`; `QueuedMessageView` gains `task_id: Option<String>`, `task_status: Option<String>`. Wire event name: `"thread:turn-dispatched"`.

- [ ] **Step 1: Write the failing test**

Add to the existing `#[cfg(test)] mod tests` in `crates/emergent-protocol/src/types.rs`:

```rust
    #[test]
    fn turn_dispatched_event_name_thread_id_and_roundtrip() {
        let n = Notification::TurnDispatched(TurnDispatchedPayload {
            thread_id: "t1".into(),
            user_text: Some("do the thing".into()),
            notifications: vec![QueuedMessageView {
                id: "m1".into(),
                source: "task".into(),
                from: None,
                task_id: Some("TSK-1".into()),
                task_status: Some("completed".into()),
                content: "done".into(),
                created_at: "2026-07-08T00:00:00Z".into(),
            }],
        });
        assert_eq!(n.event_name(), "thread:turn-dispatched");
        assert_eq!(n.thread_id(), Some("t1"));

        let json = serde_json::to_string(&n).unwrap();
        assert!(json.contains("thread:turn-dispatched"));
        assert!(json.contains("TSK-1"));

        let back: Notification = serde_json::from_str(&json).unwrap();
        assert_eq!(back.thread_id(), Some("t1"));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p emergent-protocol turn_dispatched_event_name_thread_id_and_roundtrip`
Expected: FAIL to compile — `TurnDispatchedPayload` and the `TurnDispatched` variant / new fields don't exist yet.

- [ ] **Step 3: Write minimal implementation**

In `crates/emergent-protocol/src/types.rs`, extend `QueuedMessageView`:

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QueuedMessageView {
    pub id: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// Present when `source == "task"` — the task id for the Rail label.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    /// Present when `source == "task"` — the notification kind
    /// (`started` | `update` | `completed`) driving the Rail status glyph.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_status: Option<String>,
    pub content: String,
    pub created_at: String,
}
```

Add `TurnDispatchedPayload` immediately after `QueueChangedPayload`:

```rust
/// Emitted by the prompt loop once a drained turn is **accepted by the command
/// loop** (channel-accepted), carrying the split for the transcript: `user_text`
/// is the bare-coalesced user messages (None if the batch had none), and
/// `notifications` are the task/thread items that were dispatched this turn.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TurnDispatchedPayload {
    pub thread_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_text: Option<String>,
    pub notifications: Vec<QueuedMessageView>,
}
```

Add the enum variant (after `QueueChanged`):

```rust
    #[serde(rename = "thread:turn-dispatched")]
    TurnDispatched(TurnDispatchedPayload),
```

Add the `event_name` arm (after the `QueueChanged` arm):

```rust
            Notification::TurnDispatched(_) => "thread:turn-dispatched",
```

Add the `thread_id` arm (after the `QueueChanged` arm):

```rust
            Notification::TurnDispatched(p) => Some(&p.thread_id),
```

In `crates/emergent-core/src/agent/queue.rs`, update `view()` so the struct still constructs (and carries task metadata):

```rust
    fn view(&self) -> QueuedMessageView {
        let (task_id, task_status) = match &self.source {
            MessageSource::Task { task_id, kind } => (Some(task_id.clone()), Some(kind.clone())),
            _ => (None, None),
        };
        QueuedMessageView {
            id: self.id.clone(),
            source: self.source.tag().to_string(),
            from: self.source.sender_label(),
            task_id,
            task_status,
            content: self.content.clone(),
            created_at: self.created_at.clone(),
        }
    }
```

In `src-tauri/src/lib.rs`, add a bridge arm alongside the others (e.g. after the `QueueChanged` arm) in the `match &notification` block:

```rust
                                Notification::TurnDispatched(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p emergent-protocol turn_dispatched_event_name_thread_id_and_roundtrip`
Expected: PASS.
Run: `cargo check --workspace`
Expected: builds clean (confirms `queue.rs::view()` and the `lib.rs` bridge arm satisfy the struct/enum changes).

- [ ] **Step 5: Commit**

```bash
git add crates/emergent-protocol/src/types.rs crates/emergent-core/src/agent/queue.rs src-tauri/src/lib.rs
git commit -m "feat(protocol): add TurnDispatched event + task metadata on QueuedMessageView"
```

---

### Task 2: `queue.rs` — `partition_dispatch()` split helper

**Files:**

- Modify: `crates/emergent-core/src/agent/queue.rs` (add `partition_dispatch`; add `#[cfg(test)] mod tests` at end of file)
- Test: `crates/emergent-core/src/agent/queue.rs` (new `mod tests`)

**Interfaces:**

- Consumes: `QueuedMessage`, `MessageSource` (this module), `QueuedMessageView` (`emergent_protocol`).
- Produces: `pub fn partition_dispatch(messages: &[QueuedMessage]) -> (Option<String>, Vec<QueuedMessageView>)`.

- [ ] **Step 1: Write the failing test**

Add at the end of `crates/emergent-core/src/agent/queue.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn msg(id: &str, source: MessageSource, content: &str) -> QueuedMessage {
        QueuedMessage {
            id: id.into(),
            source,
            content: content.into(),
            created_at: "2026-07-08T00:00:00Z".into(),
        }
    }

    fn thread_src() -> MessageSource {
        MessageSource::Thread { from_thread_id: "b".into(), from_name: "Agent B".into() }
    }
    fn task_src() -> MessageSource {
        MessageSource::Task { task_id: "TSK-1".into(), kind: "completed".into() }
    }

    #[test]
    fn partition_dispatch_splits_mixed_batch() {
        let batch = vec![
            msg("u1", MessageSource::User, "first"),
            msg("t1", thread_src(), "ping"),
            msg("u2", MessageSource::User, "second"),
            msg("k1", task_src(), "done"),
        ];
        let (user_text, notifications) = partition_dispatch(&batch);
        assert_eq!(user_text.as_deref(), Some("first\n\nsecond"));
        assert_eq!(notifications.len(), 2);
        assert_eq!(notifications[0].source, "thread");
        assert_eq!(notifications[0].from.as_deref(), Some("Agent B"));
        assert_eq!(notifications[1].source, "task");
        assert_eq!(notifications[1].task_id.as_deref(), Some("TSK-1"));
        assert_eq!(notifications[1].task_status.as_deref(), Some("completed"));
    }

    #[test]
    fn partition_dispatch_notification_only_has_no_user_text() {
        let (user_text, notifications) = partition_dispatch(&[msg("t1", thread_src(), "ping")]);
        assert_eq!(user_text, None);
        assert_eq!(notifications.len(), 1);
    }

    #[test]
    fn partition_dispatch_user_only_has_empty_notifications() {
        let (user_text, notifications) = partition_dispatch(&[msg("u1", MessageSource::User, "hi")]);
        assert_eq!(user_text.as_deref(), Some("hi"));
        assert!(notifications.is_empty());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p emergent-core partition_dispatch`
Expected: FAIL to compile — `partition_dispatch` not defined.

- [ ] **Step 3: Write minimal implementation**

Add to `crates/emergent-core/src/agent/queue.rs` (module-level `pub fn`, e.g. after `impl QueuedMessage`):

```rust
/// Split a drained batch into the transcript-facing `(user_text, notifications)`
/// for a `TurnDispatched` event. `user_text` is the bare-coalesced `User`
/// messages joined by a blank line (None if there were none); `notifications`
/// are the `Task`/`Thread` items as views, in queue order. This is independent
/// of the agent-facing prompt, which is still built from `render()` over all
/// sources.
pub fn partition_dispatch(messages: &[QueuedMessage]) -> (Option<String>, Vec<QueuedMessageView>) {
    let user_parts: Vec<&str> = messages
        .iter()
        .filter(|m| matches!(m.source, MessageSource::User))
        .map(|m| m.content.as_str())
        .collect();
    let user_text = if user_parts.is_empty() {
        None
    } else {
        Some(user_parts.join("\n\n"))
    };
    let notifications = messages
        .iter()
        .filter(|m| !matches!(m.source, MessageSource::User))
        .map(QueuedMessage::view)
        .collect();
    (user_text, notifications)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p emergent-core partition_dispatch`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/emergent-core/src/agent/queue.rs
git commit -m "feat(queue): add partition_dispatch split helper for TurnDispatched"
```

---

### Task 3: `queue.rs` — source-scoped mutations (user-only clear/reorder, immutable notifications)

**Files:**

- Modify: `crates/emergent-core/src/agent/queue.rs` (`edit` ~L140, `remove` ~L156, `reorder` ~L166; add `clear_user`)
- Test: `crates/emergent-core/src/agent/queue.rs` (`mod tests` from Task 2)

**Interfaces:**

- Produces: `ThreadQueue::clear_user()` (async); `edit`/`remove` now reject non-`User` ids (return `false`); `reorder` reorders only `User` items in place.
- Consumes: existing `ThreadQueue::new(WorkspaceId)`, `push`.

- [ ] **Step 1: Write the failing test**

Add to `mod tests` in `crates/emergent-core/src/agent/queue.rs` (reuse `msg`, `thread_src`, `task_src` helpers):

```rust
    use emergent_protocol::WorkspaceId;

    async fn queue_with(items: Vec<QueuedMessage>) -> ThreadQueue {
        let q = ThreadQueue::new(WorkspaceId::from("ws-test"));
        for m in items {
            q.push(m).await;
        }
        q
    }

    #[tokio::test]
    async fn clear_user_removes_only_user_items() {
        let q = queue_with(vec![
            msg("u1", MessageSource::User, "a"),
            msg("t1", thread_src(), "ping"),
            msg("k1", task_src(), "done"),
        ])
        .await;
        q.clear_user().await;
        let ids: Vec<String> = q.snapshot().await.into_iter().map(|v| v.id).collect();
        assert_eq!(ids, vec!["t1".to_string(), "k1".to_string()]);
    }

    #[tokio::test]
    async fn edit_and_remove_reject_non_user_items() {
        let q = queue_with(vec![
            msg("u1", MessageSource::User, "a"),
            msg("t1", thread_src(), "ping"),
        ])
        .await;
        assert!(!q.edit("t1", "hacked".into()).await);
        assert!(!q.remove("t1").await);
        assert!(q.edit("u1", "edited".into()).await);
        assert!(q.remove("u1").await);
        let ids: Vec<String> = q.snapshot().await.into_iter().map(|v| v.id).collect();
        assert_eq!(ids, vec!["t1".to_string()]);
    }

    #[tokio::test]
    async fn reorder_reorders_only_user_items_in_place() {
        let q = queue_with(vec![
            msg("u1", MessageSource::User, "a"),
            msg("t1", thread_src(), "ping"),
            msg("u2", MessageSource::User, "b"),
        ])
        .await;
        q.reorder(&["u2".to_string(), "u1".to_string()]).await;
        let ids: Vec<String> = q.snapshot().await.into_iter().map(|v| v.id).collect();
        // t1 keeps its middle slot; the two user slots swap.
        assert_eq!(ids, vec!["u2".to_string(), "t1".to_string(), "u1".to_string()]);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p emergent-core clear_user_removes_only_user_items edit_and_remove_reject_non_user_items reorder_reorders_only_user_items_in_place`
Expected: FAIL to compile — `clear_user` missing; `edit`/`remove`/`reorder` don't yet guard by source.

- [ ] **Step 3: Write minimal implementation**

In `crates/emergent-core/src/agent/queue.rs`, add `clear_user` (leave the existing `clear` for kill/purge) and guard the mutators:

```rust
    /// Remove only `User`-source items (the composer's "Clear all"). Task/Thread
    /// notifications are read-only and stay queued until drained.
    pub async fn clear_user(&self) {
        self.items
            .lock()
            .await
            .retain(|m| !matches!(m.source, MessageSource::User));
    }
```

Replace `edit`:

```rust
    /// Replace the text of a queued **user** message. Returns `false` if `id` is
    /// absent or names a non-`User` (immutable) item.
    pub async fn edit(&self, id: &str, content: String) -> bool {
        let mut items = self.items.lock().await;
        match items.iter_mut().find(|m| m.id == id) {
            Some(m) if matches!(m.source, MessageSource::User) => {
                m.content = content;
                true
            }
            _ => false,
        }
    }
```

Replace `remove`:

```rust
    /// Remove a queued **user** message by id. Returns `false` if not present or
    /// if `id` names a non-`User` (immutable) item.
    pub async fn remove(&self, id: &str) -> bool {
        let mut items = self.items.lock().await;
        let removable = items
            .iter()
            .any(|m| m.id == id && matches!(m.source, MessageSource::User));
        if !removable {
            return false;
        }
        items.retain(|m| m.id != id);
        true
    }
```

Replace `reorder` (reorder only `User` items; non-`User` keep their absolute slots):

```rust
    /// Reorder only the `User` items to match `ids`, leaving `Task`/`Thread`
    /// items in their existing positions. User ids not named are appended after
    /// the named ones, in their prior relative order.
    pub async fn reorder(&self, ids: &[String]) {
        let mut items = self.items.lock().await;
        let user_slots: Vec<usize> = items
            .iter()
            .enumerate()
            .filter(|(_, m)| matches!(m.source, MessageSource::User))
            .map(|(i, _)| i)
            .collect();
        let mut users: Vec<QueuedMessage> = user_slots.iter().map(|&i| items[i].clone()).collect();

        let mut reordered: Vec<QueuedMessage> = Vec::with_capacity(users.len());
        for id in ids {
            if let Some(pos) = users.iter().position(|m| &m.id == id) {
                reordered.push(users.remove(pos));
            }
        }
        reordered.extend(users);

        for (slot, m) in user_slots.iter().zip(reordered.into_iter()) {
            items[*slot] = m;
        }
    }
```

Wire the `clear_queue` Tauri command to `clear_user`: in `src-tauri/src/commands.rs`, find the `clear_queue` handler (~L191) and change its call from the manager's clear-queue path to the user-only clear. In `crates/emergent-core/src/agent/mod.rs` and `thread_manager.rs`, the `clear_queue` public method should call `ThreadQueue::clear_user()` instead of `clear()`. (Search for `.clear()` reachable from `clear_queue`; leave `kill`/purge on `clear()`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p emergent-core clear_user_removes_only_user_items edit_and_remove_reject_non_user_items reorder_reorders_only_user_items_in_place`
Expected: PASS (3 tests).
Run: `bun run lint:rust`
Expected: clippy clean.

- [ ] **Step 5: Commit**

```bash
git add crates/emergent-core/src/agent/queue.rs crates/emergent-core/src/agent/mod.rs crates/emergent-core/src/agent/thread_manager.rs src-tauri/src/commands.rs
git commit -m "feat(queue): user-scoped clear/reorder; make notifications immutable"
```

---

### Task 4: `prompt_loop.rs` — emit `TurnDispatched` (accept-gated, ordered)

**Files:**

- Modify: `crates/emergent-core/src/agent/prompt_loop.rs` (imports; drain block ~L27; Phase 3 `Ok(())` arm ~L116)
- Test: `crates/emergent-core/tests/integration.rs`

**Interfaces:**

- Consumes: `super::queue::partition_dispatch` (Task 2); `emergent_protocol::TurnDispatchedPayload` + `Notification::TurnDispatched` (Task 1).
- Produces: a `Notification::TurnDispatched` on `event_tx` per accepted turn, emitted after `command_tx.send` returns `Ok` and after `drop(handle)`, before awaiting the reply.

- [ ] **Step 1: Write the failing test**

Add to `crates/emergent-core/tests/integration.rs`. First a whole-thread collector (place near `collect_turn`):

```rust
/// Collect ALL notifications for `thread_id` (including TurnDispatched) until the
/// turn's PromptComplete. Unlike `collect_turn`, this does not filter by variant.
async fn collect_all_for_thread(
    rx: &mut broadcast::Receiver<Notification>,
    thread_id: &str,
    within: std::time::Duration,
) -> Vec<Notification> {
    tokio::time::timeout(within, async {
        let mut out = Vec::new();
        loop {
            match rx.recv().await {
                Ok(n) => {
                    if n.thread_id() == Some(thread_id) {
                        let done = matches!(&n, Notification::PromptComplete(_));
                        out.push(n);
                        if done {
                            return out;
                        }
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return out,
            }
        }
    })
    .await
    .expect("timed out waiting for PromptComplete")
}
```

Then the test (mirror the setup of `mock_agent_use_tools_streams_tool_call_and_message`):

```rust
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn turn_dispatched_emitted_before_response_and_recorded() {
    use emergent_protocol::WorkspaceId;
    use std::time::Duration;
    use tempfile::TempDir;

    let mock_bin = ensure_mock_agent();
    let tmp = TempDir::new().unwrap();
    let ws_id = WorkspaceId::from("it-ws-turn-dispatched");

    let (_url, _registry, manager, event_tx) = spawn_test_server_with_events().await;
    manager
        .thread_manager()
        .register_workspace_for_test(ws_id.clone(), tmp.path().to_path_buf())
        .await;

    let cli = format!("'{}'", mock_bin.display());
    let agent_id = manager
        .create_agent(ws_id.clone(), "mock".into(), cli, Some("mock".into()))
        .await
        .expect("create_agent");

    let mut rx = event_tx.subscribe();
    let thread_id = manager.spawn_thread(&agent_id, None).await.expect("spawn_thread");
    wait_for_session_ready(&mut rx, &thread_id, Duration::from_secs(20)).await;

    // A single inbound inter-thread notification, no user text.
    manager
        .enqueue_message(
            &thread_id,
            emergent_core::agent::queue::MessageSource::Thread {
                from_thread_id: "b".into(),
                from_name: "Agent B".into(),
            },
            "ping from B".into(),
        )
        .await
        .expect("enqueue_message");

    let notifs = collect_all_for_thread(&mut rx, &thread_id, Duration::from_secs(20)).await;

    let td_idx = notifs
        .iter()
        .position(|n| matches!(n, Notification::TurnDispatched(_)))
        .expect("TurnDispatched emitted");
    if let Some(chunk_idx) = notifs.iter().position(|n| matches!(n, Notification::MessageChunk(_))) {
        assert!(td_idx < chunk_idx, "TurnDispatched must precede the assistant response");
    }
    match &notifs[td_idx] {
        Notification::TurnDispatched(p) => {
            assert_eq!(p.user_text, None);
            assert_eq!(p.notifications.len(), 1);
            assert_eq!(p.notifications[0].source, "thread");
            assert_eq!(p.notifications[0].from.as_deref(), Some("Agent B"));
            assert_eq!(p.notifications[0].content, "ping from B");
        }
        _ => unreachable!(),
    }

    let history = manager.thread_manager().get_history(&thread_id).await.unwrap();
    assert!(
        history.iter().any(|n| matches!(n, Notification::TurnDispatched(_))),
        "TurnDispatched must be recorded in history"
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p emergent-core --test integration turn_dispatched_emitted_before_response_and_recorded -- --nocapture`
Expected: FAIL — no `TurnDispatched` is emitted yet (`expect("TurnDispatched emitted")` panics).

- [ ] **Step 3: Write minimal implementation**

In `crates/emergent-core/src/agent/prompt_loop.rs`:

Add to the `use` for `emergent_protocol` (it already imports several — add `TurnDispatchedPayload`):

```rust
use emergent_protocol::{
    AgentStatus, Notification, QueueChangedPayload, StatusChangePayload, SystemMessagePayload,
    TurnDispatchedPayload,
};
```

Right after the drain unwraps `messages` (just after the empty `QueueChanged` send, before Phase 2), compute the split once:

```rust
        // Compute the transcript-facing split now, while `messages` is in scope.
        // Emitted only once the command loop accepts the prompt (Phase 3).
        let (td_user_text, td_notifications) = super::queue::partition_dispatch(&messages);
```

In Phase 3, inside the `Ok(())` arm, emit **after** `drop(handle)` and **before** the `await`:

```rust
                match cmd_result {
                    Ok(()) => {
                        drop(handle); // Release lock while waiting.
                        // Accept-gated: the command was accepted into the live
                        // thread's channel. Emit the settled-notification event
                        // before awaiting the reply so it is recorded ahead of the
                        // assistant's streamed chunks.
                        let _ = event_tx.send(Notification::TurnDispatched(TurnDispatchedPayload {
                            thread_id: agent_id.clone(),
                            user_text: td_user_text,
                            notifications: td_notifications,
                        }));
                        prompt_reply_rx
                            .await
                            .unwrap_or(Err("Agent thread terminated during prompt".to_string()))
                    }
                    Err(_) => Err("Agent thread has terminated".to_string()),
                }
```

(The `Err(_)` arm is unchanged — no `TurnDispatched` on a rejected send, so a failed send never settles notifications.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p emergent-core --test integration turn_dispatched_emitted_before_response_and_recorded`
Expected: PASS.
Run: `bun run lint:rust`
Expected: clippy clean (watch for a moved-value error — `td_user_text`/`td_notifications` are moved into the event, which is correct since the arm runs once).

- [ ] **Step 5: Commit**

```bash
git add crates/emergent-core/src/agent/prompt_loop.rs crates/emergent-core/tests/integration.rs
git commit -m "feat(prompt-loop): emit accept-gated TurnDispatched before the turn's response"
```

---

### Task 5: Store — `handleTurnDispatched` + drop `is_echo` echo + types

**Files:**

- Modify: `src/stores/types.ts` (`QueuedMessageView`; add `TurnDispatchedPayload`; `DisplayMessage`; `DaemonNotification` union)
- Modify: `src/stores/agents.svelte.ts` (`viewToNotification`, `handleTurnDispatched`, `handleUserMessage`, listener, `_test`)
- Test: `src/stores/agents.svelte.test.ts`

**Interfaces:**

- Consumes: `TurnDispatchedPayload` wire shape from Task 1 (`{ thread_id, user_text?, notifications: QueuedMessageView[] }`).
- Produces: `agentStore._test.handleTurnDispatched(payload)`; `DisplayMessage` role `"notification"` with `source`/`from`/`taskId`/`taskStatus`; listener on `thread:turn-dispatched`.

- [ ] **Step 1: Write the failing test**

Add to `src/stores/agents.svelte.test.ts`:

```ts
describe("handleTurnDispatched", () => {
  it("appends settled notification blocks then a user bubble (busy path)", () => {
    makeThread("t-td", "working");
    const thread = agentStore.threads["t-td"]!;

    agentStore._test.handleTurnDispatched({
      thread_id: "t-td",
      user_text: "do the thing",
      notifications: [
        {
          id: "n1",
          source: "thread",
          from: "Agent B",
          content: "ping",
          created_at: new Date().toISOString(),
        },
        {
          id: "n2",
          source: "task",
          task_id: "TSK-1",
          task_status: "completed",
          content: "done",
          created_at: new Date().toISOString(),
        },
      ],
    });
    flushSync();

    const roles = thread.messages.map((m) => m.role);
    expect(roles).toEqual(["notification", "notification", "user"]);
    expect(thread.messages[0]!.id).toBe("n1");
    expect(thread.messages[0]!.from).toBe("Agent B");
    expect(thread.messages[1]!.taskId).toBe("TSK-1");
    expect(thread.messages[2]!.content).toBe("do the thing");
  });

  it("is idempotent — a repeated notification id is not duplicated", () => {
    makeThread("t-td2", "working");
    const thread = agentStore.threads["t-td2"]!;
    const payload = {
      thread_id: "t-td2",
      notifications: [
        {
          id: "n1",
          source: "task",
          task_id: "TSK-9",
          task_status: "update",
          content: "half",
          created_at: new Date().toISOString(),
        },
      ],
    };
    agentStore._test.handleTurnDispatched(payload);
    agentStore._test.handleTurnDispatched(payload);
    flushSync();
    expect(thread.messages.filter((m) => m.role === "notification")).toHaveLength(1);
  });

  it("re-anchors an idle optimistic bubble below the notifications", () => {
    makeThread("t-td3", "working");
    const thread = agentStore.threads["t-td3"]!;
    thread.messages.push({
      id: "opt",
      role: "user",
      content: "do the thing",
      timestamp: "12:00",
      sending: true,
    });

    agentStore._test.handleTurnDispatched({
      thread_id: "t-td3",
      user_text: "do the thing",
      notifications: [
        {
          id: "n1",
          source: "thread",
          from: "Agent B",
          content: "ping",
          created_at: new Date().toISOString(),
        },
      ],
    });
    flushSync();

    const roles = thread.messages.map((m) => m.role);
    expect(roles).toEqual(["notification", "user"]);
    const bubble = thread.messages[1]!;
    expect(bubble.id).toBe("opt");
    expect(bubble.sending).toBeFalsy();
  });
});

describe("handleUserMessage echo drop", () => {
  it("ignores is_echo=true and pushes is_echo=false", () => {
    makeThread("t-echo", "working");
    const thread = agentStore.threads["t-echo"]!;

    agentStore._test.handleUserMessage({
      thread_id: "t-echo",
      content: "[task completed] x",
      is_echo: true,
    });
    flushSync();
    expect(thread.messages).toHaveLength(0);

    agentStore._test.handleUserMessage({
      thread_id: "t-echo",
      content: "spontaneous",
      is_echo: false,
    });
    flushSync();
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.role).toBe("user");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/stores/agents.svelte.test.ts -t "handleTurnDispatched"`
Expected: FAIL — `agentStore._test.handleTurnDispatched` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/stores/types.ts`, extend `QueuedMessageView`:

```ts
export interface QueuedMessageView {
  id: string;
  source: "user" | "task" | "thread";
  from?: string;
  task_id?: string;
  task_status?: string;
  content: string;
  created_at: string;
}
```

Add `TurnDispatchedPayload`:

```ts
/** Wire-format payload for the `thread:turn-dispatched` Tauri event. */
export interface TurnDispatchedPayload {
  thread_id: string;
  user_text?: string | null;
  notifications: QueuedMessageView[];
}
```

Extend `DisplayMessage`:

```ts
export interface DisplayMessage {
  id: string;
  role: "assistant" | "thinking" | "user" | "tool-group" | "system" | "nudge" | "notification";
  content: string;
  toolCalls?: DisplayToolCall[];
  timestamp: string;
  nudgeCount?: number;
  sending?: boolean;
  cancelled?: boolean;
  // Notification-block fields (role === "notification"):
  source?: "task" | "thread";
  from?: string;
  taskId?: string;
  // Real kinds: "started" | "update" | "completed". "failed"/"ready" supported but not emitted today.
  taskStatus?: "started" | "update" | "completed" | "failed" | "ready";
}
```

In `src/stores/agents.svelte.ts`, add the `TurnDispatchedPayload` import to the existing `types` import block, then add a converter + handler. Place `viewToNotification` near `viewToQueueItem`:

```ts
function viewToNotification(v: QueuedMessageView): DisplayMessage {
  const m: DisplayMessage = {
    id: v.id,
    role: "notification",
    content: v.content,
    timestamp: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    source: v.source === "thread" ? "thread" : "task",
  };
  if (v.from !== undefined) m.from = v.from;
  if (v.task_id !== undefined) m.taskId = v.task_id;
  if (v.task_status !== undefined) m.taskStatus = v.task_status as DisplayMessage["taskStatus"];
  return m;
}

/**
 * A drained turn was accepted by the command loop. Settle its notifications as
 * read-only transcript blocks (dedupe-by-id), then render the user bubble from
 * `user_text` only — notifications-first canonical order. Owns the reconciliation
 * of the idle optimistic bubble (handleUserMessage no longer does).
 */
function handleTurnDispatched(payload: TurnDispatchedPayload) {
  const thread = threads[payload.thread_id];
  if (!thread) return;

  for (const v of payload.notifications) {
    if (thread.messages.some((m) => m.role === "notification" && m.id === v.id)) continue;
    thread.messages.push(viewToNotification(v));
  }

  if (payload.user_text != null && payload.user_text !== "") {
    const ts = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const optimistic = thread.messages.find((m) => m.sending === true);
    if (optimistic) {
      // Re-anchor below the notifications + normalize the timestamp so it does
      // not read earlier than the rails now above it.
      const idx = thread.messages.indexOf(optimistic);
      thread.messages.splice(idx, 1);
      optimistic.sending = false;
      optimistic.timestamp = ts;
      thread.messages.push(optimistic);
    } else {
      thread.messages.push({
        id: crypto.randomUUID(),
        role: "user",
        content: payload.user_text,
        timestamp: ts,
      });
    }
  }
}
```

Change `handleUserMessage` so the echo is dropped entirely:

```ts
function handleUserMessage(payload: UserMessagePayload) {
  const thread = threads[payload.thread_id];
  if (!thread) return;

  // The drained-turn echo is now owned by handleTurnDispatched — drop it.
  // Only spontaneous (non-echo) user messages are pushed here.
  if (payload.is_echo) return;

  thread.messages.push({
    id: crypto.randomUUID(),
    role: "user",
    content: stripSystemBlock(payload.content),
    timestamp: new Date().toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    }),
  });
}
```

Register the listener in `setupListeners` (next to the other `listen<…>` calls):

```ts
listenerCleanup.push(
  await listen<TurnDispatchedPayload>("thread:turn-dispatched", (e) =>
    handleTurnDispatched(e.payload),
  ),
);
```

Expose it on the `_test` object (next to `handleUserMessage`, `handleQueueChanged`):

```ts
      handleTurnDispatched,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/stores/agents.svelte.test.ts -t "handleTurnDispatched"`
Run: `bunx vitest run src/stores/agents.svelte.test.ts -t "handleUserMessage echo drop"`
Expected: PASS.
Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/stores/types.ts src/stores/agents.svelte.ts src/stores/agents.svelte.test.ts
git commit -m "feat(store): handle TurnDispatched; drop is_echo echo rendering"
```

---

### Task 6: Store — `replayNotifications` turn-dispatched arm + is_echo skip

**Files:**

- Modify: `src/stores/agents.svelte.ts` (`replayNotifications` ~L870; `DaemonNotification` union ~L864)
- Test: `src/stores/agents.svelte.test.ts`

**Interfaces:**

- Consumes: `handleTurnDispatched` logic (Task 5); `DisplayMessage` role `"notification"`.
- Produces: replay handles `thread:turn-dispatched`; `thread:user-message` records with `is_echo=true` are skipped on replay.

- [ ] **Step 1: Write the failing test**

Add to `src/stores/agents.svelte.test.ts`:

```ts
describe("replayNotifications with turn-dispatched", () => {
  it("rebuilds settled rails and skips the paired is_echo user-message", () => {
    makeThread("t-replay", "idle");
    const thread = agentStore.threads["t-replay"]!;

    agentStore._test.replayNotifications([
      {
        type: "thread:turn-dispatched",
        thread_id: "t-replay",
        user_text: "do the thing",
        notifications: [
          {
            id: "n1",
            source: "task",
            task_id: "TSK-1",
            task_status: "completed",
            content: "done",
            created_at: new Date().toISOString(),
          },
        ],
      },
      // The recorded echo of the same turn — must be ignored (no duplicate bubble).
      {
        type: "thread:user-message",
        thread_id: "t-replay",
        content: "[task completed] done\n\ndo the thing",
        is_echo: true,
      },
    ]);
    flushSync();

    const roles = thread.messages.map((m) => m.role);
    expect(roles).toEqual(["notification", "user"]);
    expect(thread.messages[0]!.taskId).toBe("TSK-1");
    expect(thread.messages[1]!.content).toBe("do the thing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/stores/agents.svelte.test.ts -t "replayNotifications with turn-dispatched"`
Expected: FAIL — replay renders the `is_echo=true` message as a second bubble and ignores `thread:turn-dispatched` (roles won't match).

- [ ] **Step 3: Write minimal implementation**

In `src/stores/agents.svelte.ts`, add to the `DaemonNotification` union:

```ts
    | ({ type: "thread:turn-dispatched" } & TurnDispatchedPayload)
```

In `replayNotifications`, change the `thread:user-message` case to skip echoes and add the new case. Replace the existing `case "thread:user-message":` block with:

```ts
        case "thread:user-message":
          // Drained-turn echoes are owned by thread:turn-dispatched — skip them.
          if (n.is_echo) break;
          thread.messages.push({
            id: crypto.randomUUID(),
            role: "user",
            content: stripSystemBlock(n.content),
            timestamp: new Date().toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            }),
          });
          break;

        case "thread:turn-dispatched": {
          for (const v of n.notifications) {
            if (thread.messages.some((m) => m.role === "notification" && m.id === v.id)) continue;
            thread.messages.push(viewToNotification(v));
          }
          if (n.user_text != null && n.user_text !== "") {
            thread.messages.push({
              id: crypto.randomUUID(),
              role: "user",
              content: n.user_text,
              timestamp: new Date().toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              }),
            });
          }
          break;
        }
```

(No optimistic-bubble re-anchoring in replay — replay has no in-flight bubbles.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/stores/agents.svelte.test.ts -t "replayNotifications with turn-dispatched"`
Expected: PASS.
Run: `bunx vitest run src/stores/agents.svelte.test.ts`
Expected: whole store suite PASS (regression guard — earlier user-message replay tests still hold since they use `is_echo=false` or omit it).

- [ ] **Step 5: Commit**

```bash
git add src/stores/agents.svelte.ts src/stores/agents.svelte.test.ts
git commit -m "feat(store): replay TurnDispatched and skip echoed user messages"
```

---

### Task 7: `chat-utils` — split the pending queue by source; app-state selectors

**Files:**

- Modify: `src/lib/chat-utils.ts` (add `partitionPendingQueue`)
- Modify: `src/stores/app-state.svelte.ts` (`selectedThreadComposerQueue`, `selectedThreadNotificationQueue`)
- Test: `src/lib/chat-utils.test.ts`

**Interfaces:**

- Consumes: `QueueItem` (`src/stores/types`) — has `source?: "user" | "task" | "thread"`.
- Produces: `partitionPendingQueue(items: QueueItem[]): { composer: QueueItem[]; notifications: QueueItem[] }`; app-state getters `selectedThreadComposerQueue` / `selectedThreadNotificationQueue`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/chat-utils.test.ts`:

```ts
import { partitionPendingQueue } from "./chat-utils";
import type { QueueItem } from "../stores/types";

describe("partitionPendingQueue", () => {
  const items: QueueItem[] = [
    { id: "u1", content: "a", submittedAt: 1, source: "user" },
    { id: "t1", content: "ping", submittedAt: 2, source: "thread" },
    { id: "k1", content: "done", submittedAt: 3, source: "task" },
    { id: "u2", content: "b", submittedAt: 4, source: "user" },
  ];

  it("puts user items in composer, task/thread in notifications, preserving order", () => {
    const { composer, notifications } = partitionPendingQueue(items);
    expect(composer.map((i) => i.id)).toEqual(["u1", "u2"]);
    expect(notifications.map((i) => i.id)).toEqual(["t1", "k1"]);
  });

  it("treats a missing source as user (back-compat)", () => {
    const { composer } = partitionPendingQueue([{ id: "x", content: "c", submittedAt: 1 }]);
    expect(composer.map((i) => i.id)).toEqual(["x"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/lib/chat-utils.test.ts -t "partitionPendingQueue"`
Expected: FAIL — `partitionPendingQueue` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/chat-utils.ts`:

```ts
import type { QueueItem } from "../stores/types";

/**
 * Split the backend queue mirror into the composer's user-only queue and the
 * transcript's read-only notification queue. A missing `source` is treated as
 * "user" (back-compat with items that predate source tagging).
 */
export function partitionPendingQueue(items: QueueItem[]): {
  composer: QueueItem[];
  notifications: QueueItem[];
} {
  const composer: QueueItem[] = [];
  const notifications: QueueItem[] = [];
  for (const item of items) {
    if (item.source === "task" || item.source === "thread") {
      notifications.push(item);
    } else {
      composer.push(item);
    }
  }
  return { composer, notifications };
}
```

In `src/stores/app-state.svelte.ts`, next to the existing `selectedThreadPendingQueue` getter, add two derived getters using the helper (import `partitionPendingQueue` from `../lib/chat-utils`):

```ts
    get selectedThreadComposerQueue() {
      return partitionPendingQueue(this.selectedThreadPendingQueue).composer;
    },
    get selectedThreadNotificationQueue() {
      return partitionPendingQueue(this.selectedThreadPendingQueue).notifications;
    },
```

(Leave `selectedThreadPendingQueue` in place; App.svelte still consumes it until Task 10.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/lib/chat-utils.test.ts -t "partitionPendingQueue"`
Expected: PASS.
Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-utils.ts src/lib/chat-utils.test.ts src/stores/app-state.svelte.ts
git commit -m "feat(app-state): split pending queue into composer vs notification views"
```

---

### Task 8: `NotificationRail.svelte` — the Rail component

**Files:**

- Create: `src/components/chat/NotificationRail.svelte`
- Test: `src/components/chat/NotificationRail.test.ts`

**Interfaces:**

- Consumes: props `{ state: "pending" | "submitted"; source: "task" | "thread"; label: string; from?: string; taskStatus?: string; content: string; onJump?: () => void }`.
- Produces: a read-only Rail row; pending = dashed + dimmed, submitted = solid + full opacity.

- [ ] **Step 1: Write the failing test**

Create `src/components/chat/NotificationRail.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/svelte";
import NotificationRail from "./NotificationRail.svelte";

afterEach(() => cleanup());

describe("NotificationRail", () => {
  it("renders a pending task rail dashed + dimmed with the status and label", () => {
    render(NotificationRail, {
      props: {
        state: "pending",
        source: "task",
        label: "TSK-1",
        taskStatus: "completed",
        content: "done",
      },
    });
    const rail = screen.getByTestId("notification-rail");
    expect(rail.className).toContain("border-dashed");
    expect(rail.getAttribute("data-state")).toBe("pending");
    expect(screen.getByText("TSK-1")).toBeTruthy();
    expect(screen.getByText("done")).toBeTruthy();
  });

  it("renders a submitted thread rail solid with the sender name", () => {
    render(NotificationRail, {
      props: {
        state: "submitted",
        source: "thread",
        label: "Agent B",
        from: "Agent B",
        content: "ping",
      },
    });
    const rail = screen.getByTestId("notification-rail");
    expect(rail.className).toContain("border-solid");
    expect(rail.getAttribute("data-state")).toBe("submitted");
    expect(screen.getByText("Agent B")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/components/chat/NotificationRail.test.ts`
Expected: FAIL — component file does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/chat/NotificationRail.svelte`:

```svelte
<script lang="ts">
  interface Props {
    state: "pending" | "submitted";
    source: "task" | "thread";
    label: string;
    from?: string;
    taskStatus?: "started" | "update" | "completed" | "failed" | "ready";
    content: string;
    onJump?: () => void;
  }
  let { state, source, label, taskStatus, content, onJump }: Props = $props();

  // Status glyph color for task rails. started/update are neutral in-progress.
  const statusColor: Record<string, string> = {
    completed: "var(--color-success)",
    failed: "var(--color-error)",
    ready: "var(--color-warning)",
  };
  let jumpLabel = $derived(source === "thread" ? "View thread" : "Open task");
</script>

<div
  data-testid="notification-rail"
  data-state={state}
  class="flex flex-col gap-[6px] border-l-2 border-l-border-strong pl-[14px] {state ===
  'pending'
    ? 'border-dashed opacity-[0.68]'
    : 'border-solid'}"
>
  <div class="flex items-center gap-2">
    <span class="text-[12.5px] font-semibold text-fg-heading">{label}</span>
    {#if source === "task" && taskStatus}
      <span
        class="inline-block h-[6px] w-[6px] rounded-full"
        style="background: {statusColor[taskStatus] ?? 'var(--color-fg-muted)'};"
        aria-label={taskStatus}
      ></span>
    {/if}
    <div class="flex-1"></div>
    {#if onJump}
      <button
        type="button"
        class="text-[11px] text-fg-muted hover:text-fg-heading"
        onclick={onJump}>{jumpLabel}</button
      >
    {/if}
  </div>
  <div class="text-[12.5px] leading-[1.55] text-fg-default">{content}</div>
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/components/chat/NotificationRail.test.ts`
Expected: PASS.
Run: `bun run fmt && bun run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/NotificationRail.svelte src/components/chat/NotificationRail.test.ts
git commit -m "feat(chat): add NotificationRail (pending/submitted states)"
```

---

### Task 9: `ChatArea.svelte` — render notification blocks inline + pending Rails at the tail

**Files:**

- Modify: `src/components/chat/ChatArea.svelte` (add `notificationQueue` prop; render `role: "notification"` blocks; append pending Rails before the spacer)
- Test: `src/components/chat/ChatArea.test.ts`

**Interfaces:**

- Consumes: `DisplayMessage` role `"notification"` (Task 5); `QueueItem[]` `notificationQueue`; `NotificationRail` (Task 8).
- Produces: settled notification blocks inline + pending Rails at the transcript tail.

- [ ] **Step 1: Write the failing test**

Add to `src/components/chat/ChatArea.test.ts` (follow the file's existing `makeThread`/`msg` helpers; a `notification` message needs `role: "notification"`, `source`, and `taskId`/`from`). Add a test that renders a thread whose messages include a settled notification and passes a `notificationQueue` with one pending item:

```ts
it("renders settled notification blocks inline and pending rails at the tail", () => {
  const thread = makeThread([
    msg("assistant", "working on it"),
    {
      id: "n1",
      role: "notification",
      content: "done",
      timestamp: "12:00",
      source: "task",
      taskId: "TSK-1",
      taskStatus: "completed",
    },
  ]);
  render(ChatArea, {
    props: {
      thread,
      hasTaskBanner: false,
      notificationQueue: [
        { id: "n2", content: "ping", submittedAt: 1, source: "thread", from: "Agent B" },
      ],
    },
  });
  // settled block
  const settled = screen
    .getAllByTestId("notification-rail")
    .filter((el) => el.getAttribute("data-state") === "submitted");
  expect(settled).toHaveLength(1);
  // pending rail at tail
  const pending = screen
    .getAllByTestId("notification-rail")
    .filter((el) => el.getAttribute("data-state") === "pending");
  expect(pending).toHaveLength(1);
});
```

(Adjust the `makeThread`/`msg` calls to match `ChatArea.test.ts`'s existing helpers — check the top of that file for their exact signatures.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/components/chat/ChatArea.test.ts -t "settled notification blocks"`
Expected: FAIL — ChatArea doesn't render notification role blocks or accept `notificationQueue`.

- [ ] **Step 3: Write minimal implementation**

In `src/components/chat/ChatArea.svelte`:

Import the component and add the prop (in the `<script>`; match the existing `Props` interface / `$props()` destructure):

```ts
import NotificationRail from "./NotificationRail.svelte";
import type { QueueItem } from "../../stores/types";
// add to Props:  notificationQueue?: QueueItem[];
// add to destructure:  notificationQueue = [],
```

Add a branch to the message-block `{#if} / {:else if}` chain (alongside `role === "user"` etc.) for settled notifications:

```svelte
          {:else if block.message.role === "notification"}
            <NotificationRail
              state="submitted"
              source={block.message.source ?? "task"}
              label={block.message.source === "thread"
                ? (block.message.from ?? "agent")
                : (block.message.taskId ?? "task")}
              from={block.message.from}
              taskStatus={block.message.taskStatus}
              content={block.message.content}
            />
```

Immediately **before** the bottom spacer `<div class="h-[146px] shrink-0" …>`, append the pending Rails:

```svelte
        {#each notificationQueue as item (item.id)}
          <NotificationRail
            state="pending"
            source={item.source === "thread" ? "thread" : "task"}
            label={item.source === "thread" ? (item.from ?? "agent") : (item.id)}
            from={item.from}
            content={item.content}
          />
        {/each}
```

(Pending items are `QueueItem`s; a task item's `QueueItem` has no `taskId`/`taskStatus` field today — the label falls back to the queue `id`, and the status glyph is omitted while pending. That's acceptable: the status is most meaningful once settled. If you want the pending task label/status too, thread `task_id`/`task_status` through `viewToQueueItem` into `QueueItem` in a follow-up — out of scope here.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/components/chat/ChatArea.test.ts`
Expected: PASS (new test + existing ChatArea tests).
Run: `bun run fmt && bun run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ChatArea.svelte src/components/chat/ChatArea.test.ts
git commit -m "feat(chat): render settled notifications inline + pending rails at transcript tail"
```

---

### Task 10: Wire composer to user-only queue; ChatArea to notification queue

**Files:**

- Modify: `src/components/chat/QueuedMessages.svelte` (remove the task-notification branch — user-only)
- Modify: `src/components/chat/ChatInput.svelte` (receive `composerQueue`)
- Modify: `src/App.svelte` (pass `selectedThreadComposerQueue` to ChatInput, `selectedThreadNotificationQueue` to ChatArea)
- Test: `src/components/chat/QueuedMessages.test.ts`

**Interfaces:**

- Consumes: `selectedThreadComposerQueue` / `selectedThreadNotificationQueue` (Task 7); `ChatArea` `notificationQueue` prop (Task 9).
- Produces: composer shows only user items; notifications only in the transcript. This is the atomic "flip" — after it, notifications no longer appear in the composer.

- [ ] **Step 1: Write the failing test**

Update `src/components/chat/QueuedMessages.test.ts` — the component is now user-only, so a task-notification item must render as a normal editable row (no special `task` badge / read-only gutter). Add:

```ts
it("renders every item as an editable user row (no task-notification branch)", () => {
  render(QueuedMessages, {
    props: defaultProps([
      makeItem("u1", "user message"),
      // Even if an item carries a non-user kind, the user-only composer treats it as a normal row.
      { id: "k1", content: "task note", submittedAt: Date.now() },
    ]),
  });
  // Every row exposes edit + remove actions (2 buttons per row).
  const rows = getRowButtons();
  expect(rows).toHaveLength(2);
  // No "task" badge remains.
  expect(screen.queryByText("task")).toBeNull();
});
```

Also delete the existing test(s) in this file that assert the `task-notification` read-only branch (search for `task-notification` / `isTaskNotification` and remove those `it(...)` blocks — that behavior no longer exists here).

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/components/chat/QueuedMessages.test.ts -t "no task-notification branch"`
Expected: FAIL — the component still special-cases `kind === "task-notification"`.

- [ ] **Step 3: Write minimal implementation**

In `src/components/chat/QueuedMessages.svelte`, remove the task-notification special-casing:

- Delete the `{@const isTaskNotification = item.kind === "task-notification"}` line.
- Replace the `{#if isTaskNotification} … {:else} <index badge> {/if}` index cell with just the index badge (the `{:else}` branch).
- Replace the `{#if !isTaskNotification} <edit/remove gutter> {:else} <empty placeholder> {/if}` with just the edit/remove gutter (the `{#if}` branch), unconditionally.
- Remove `isTaskNotification` from the `aria-label` template.

In `src/components/chat/ChatInput.svelte`, rename the incoming prop usage from `pendingQueue` to the composer queue — keep the prop name `pendingQueue` (minimal churn) but App will now pass the user-only list into it. No component-internal change needed beyond confirming it renders `pendingQueue` via `QueuedMessages` (it does).

In `src/App.svelte`, update both `ChatArea` + `ChatInput` call sites (there are two — the task view ~L349 and the agent view ~L401):

```svelte
        <ChatArea {thread} hasTaskBanner={task != null}
          notificationQueue={appState.selectedThreadNotificationQueue} />
        <ChatInput
          ...
          pendingQueue={appState.selectedThreadComposerQueue}
```

and the second block:

```svelte
        <ChatArea thread={appState.selectedAgent} hasTaskBanner={false}
          notificationQueue={appState.selectedThreadNotificationQueue} />
        <ChatInput
          ...
          pendingQueue={appState.selectedThreadComposerQueue}
```

(Leave the other `ChatInput` props unchanged; only `pendingQueue`'s source changes.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/components/chat/QueuedMessages.test.ts`
Expected: PASS (updated suite).
Run: `bun run typecheck && bun run lint`
Expected: clean.
Run: `bun run test`
Expected: full frontend unit suite green.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/QueuedMessages.svelte src/components/chat/QueuedMessages.test.ts src/components/chat/ChatInput.svelte src/App.svelte
git commit -m "feat(chat): move notifications to transcript; composer queue is user-only"
```

---

### Task 11: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the complete pre-build + test gate**

Run:

```bash
bun run prebuild        # lint + lint:rust + fmt:check + typecheck
bun run test            # Vitest unit/component
bun run test:rust       # cargo test --workspace
```

Expected: all green.

- [ ] **Step 2: Drive the app to confirm behavior end-to-end**

Use the `verify` skill (or `bun run dev`): spawn two agents in a workspace, have one `send_message` the other, and confirm:

- the notification appears as a **pending (dashed/dimmed) Rail at the transcript tail**, not in the composer;
- after the recipient's next turn it becomes a **solid Rail woven inline**, and no `[message from …]` user bubble appears;
- the composer's "Queued · N" panel only ever shows the user's own sends.

- [ ] **Step 3: Commit any fixups**

```bash
git add <files>
git commit -m "fix: address verification findings for notification queue split"
```

---

## Self-Review

**Spec coverage** — every spec section maps to a task:

- Pending render split → Task 7 (partition) + Task 9 (pending Rails) + Task 10 (wiring).
- Consumed "settle in place" + `TurnDispatched` → Task 1 (event) + Task 4 (emit) + Task 5 (handler).
- Emission point / accept-gated / failure semantics → Task 4 (emit in `Ok` arm after `drop(handle)`; integration test asserts ordering + recording; failure path guarded by construction — only the `Ok` arm emits).
- Authoritative echo rule (both paths) → Task 5 (`handleUserMessage`) + Task 6 (`replayNotifications`).
- Visual language (dashed→solid, opacity) → Task 8.
- Task-kind mapping (`started`/`update`/`completed`) → Task 1 (`view()`) + Task 8 (glyph colors) + tests.
- Composer user-scoping + backend-enforced immutability → Task 3.
- `id`-keyed idempotency + canonical order + re-anchor timestamp → Task 5 (+ Task 6).
- `QueueChanged` deliberately excluded from replay → Task 6 (only `turn-dispatched` added to the union).
- Persistence: within-session survival → Task 6 (replay); cross-restart fallback needs no code (ACP replay hits Task 5's `is_echo=false` push path).

**Placeholder scan:** every code step contains complete code; commands have expected output. Two intentional "search-and-adjust" notes (Task 3's `clear_queue` call-site, Task 9/10's existing test-helper signatures) point at concrete symbols to locate, not vague work.

**Type consistency:** `TurnDispatchedPayload` fields (`thread_id`, `user_text`, `notifications`) are identical across Rust (Task 1) and TS (Task 5). `QueuedMessageView` gains `task_id`/`task_status` (snake_case on the wire, Task 1) mapped to `taskId`/`taskStatus` on `DisplayMessage` (camelCase, Task 5). `partition_dispatch` (Rust) and `partitionPendingQueue` (TS) are distinct helpers with distinct names — no collision. `handleTurnDispatched`, `viewToNotification` names are consistent between Task 5 and Task 6.
