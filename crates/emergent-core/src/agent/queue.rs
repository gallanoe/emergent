//! Per-thread backend message queue.
//!
//! Replaces the old single-slot `pending_prompt` on `ThreadHandle`. The queue is
//! owned by `ThreadManager` and keyed by `thread_id`, so it **outlives the live
//! `ThreadHandle`**: a message can be enqueued for a dormant thread and held
//! until the thread is resumed and drains it. Messages carry a `MessageSource`
//! so the prompt loop can annotate inter-thread / task messages, and so the
//! frontend can badge each queued chip.
//!
//! Concurrency: `items` is a `tokio::Mutex` (held only for short, non-awaiting
//! critical sections); `notify` wakes the thread's prompt loop when work lands.

use std::collections::VecDeque;

use emergent_protocol::{QueuedMessageView, WorkspaceId};
use tokio::sync::{Mutex, Notify};

/// Where a queued message originated. Drives prompt formatting and the UI badge.
#[derive(Clone, Debug)]
pub enum MessageSource {
    /// A user-typed prompt. Rendered bare (no header).
    User,
    /// A task lifecycle notification routed to a subscriber.
    Task { task_id: String, kind: String },
    /// An inter-thread message sent via the `send_message` MCP tool.
    Thread {
        from_thread_id: String,
        from_name: String,
    },
}

impl MessageSource {
    fn tag(&self) -> &'static str {
        match self {
            MessageSource::User => "user",
            MessageSource::Task { .. } => "task",
            MessageSource::Thread { .. } => "thread",
        }
    }

    fn sender_label(&self) -> Option<String> {
        match self {
            MessageSource::Thread { from_name, .. } => Some(from_name.clone()),
            _ => None,
        }
    }
}

/// A single queued message with a stable `id` for edit/remove/reorder.
#[derive(Clone, Debug)]
pub struct QueuedMessage {
    pub id: String,
    pub source: MessageSource,
    pub content: String,
    pub created_at: String,
}

impl QueuedMessage {
    /// Render this message for injection into the agent prompt. `User` messages
    /// are emitted bare (they are already the user's exact text or a
    /// fully-formatted task prompt); other sources get a short provenance header
    /// so the agent knows the message came from elsewhere.
    pub fn render(&self) -> String {
        match &self.source {
            MessageSource::User => self.content.clone(),
            MessageSource::Task { kind, .. } => {
                format!("[task {}]\n{}", kind, self.content)
            }
            MessageSource::Thread { from_name, .. } => {
                format!("[message from {}]\n{}", from_name, self.content)
            }
        }
    }

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
}

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

/// A thread's message queue plus the notifier its prompt loop waits on. Stored
/// in `ThreadManager` behind an `Arc`, independent of the `ThreadHandle`'s
/// lifecycle so held messages survive dormancy.
pub struct ThreadQueue {
    /// Workspace the owning thread belongs to (for persistence routing).
    pub workspace_id: WorkspaceId,
    items: Mutex<VecDeque<QueuedMessage>>,
    /// Woken when a message is enqueued so the prompt loop re-checks for work.
    pub notify: Notify,
}

impl ThreadQueue {
    pub fn new(workspace_id: WorkspaceId) -> Self {
        Self {
            workspace_id,
            items: Mutex::new(VecDeque::new()),
            notify: Notify::new(),
        }
    }

    /// Append a message and wake the prompt loop. Returns the resulting queue
    /// snapshot so the caller can emit a `QueueChanged` view without a second lock.
    pub async fn push(&self, msg: QueuedMessage) -> Vec<QueuedMessageView> {
        let snapshot = {
            let mut items = self.items.lock().await;
            items.push_back(msg);
            items.iter().map(QueuedMessage::view).collect()
        };
        self.notify.notify_one();
        snapshot
    }

    /// Remove and return **all** currently-queued messages, coalescing them into
    /// one turn. Returns `None` if the queue is empty.
    pub async fn drain_all(&self) -> Option<Vec<QueuedMessage>> {
        let mut items = self.items.lock().await;
        if items.is_empty() {
            return None;
        }
        Some(items.drain(..).collect())
    }

    /// True if there is at least one queued message.
    pub async fn has_work(&self) -> bool {
        !self.items.lock().await.is_empty()
    }

    /// Current queue as frontend views.
    pub async fn snapshot(&self) -> Vec<QueuedMessageView> {
        self.items.lock().await.iter().map(QueuedMessage::view).collect()
    }

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

    /// Remove all queued messages, regardless of source. Used by kill/purge
    /// paths that tear down a thread's queue entirely; the composer's "Clear
    /// all" should call [`Self::clear_user`] instead.
    pub async fn clear(&self) {
        self.items.lock().await.clear();
    }

    /// Remove only `User`-source items (the composer's "Clear all"). Task/Thread
    /// notifications are read-only and stay queued until drained.
    pub async fn clear_user(&self) {
        self.items.lock().await.retain(|m| !matches!(m.source, MessageSource::User));
    }

    /// Remove a queued **user** message by id. Returns `false` if not present or
    /// if `id` names a non-`User` (immutable) item.
    pub async fn remove(&self, id: &str) -> bool {
        let mut items = self.items.lock().await;
        let removable = items.iter().any(|m| m.id == id && matches!(m.source, MessageSource::User));
        if !removable {
            return false;
        }
        items.retain(|m| m.id != id);
        true
    }

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

        for (slot, m) in user_slots.iter().zip(reordered) {
            items[*slot] = m;
        }
    }
}

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
}
