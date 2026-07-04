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
        QueuedMessageView {
            id: self.id.clone(),
            source: self.source.tag().to_string(),
            from: self.source.sender_label(),
            content: self.content.clone(),
            created_at: self.created_at.clone(),
        }
    }
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

    /// Replace the text of a queued message. Returns `false` if `id` is not
    /// present (already drained or never existed).
    pub async fn edit(&self, id: &str, content: String) -> bool {
        let mut items = self.items.lock().await;
        if let Some(m) = items.iter_mut().find(|m| m.id == id) {
            m.content = content;
            true
        } else {
            false
        }
    }

    /// Remove all queued messages.
    pub async fn clear(&self) {
        self.items.lock().await.clear();
    }

    /// Remove a queued message by id. Returns `false` if not present.
    pub async fn remove(&self, id: &str) -> bool {
        let mut items = self.items.lock().await;
        let before = items.len();
        items.retain(|m| m.id != id);
        items.len() != before
    }

    /// Reorder the queue to match `ids`. Any id not present is ignored; any
    /// currently-queued message not named in `ids` is dropped to the end in its
    /// existing relative order (so a stale reorder can't silently delete work).
    pub async fn reorder(&self, ids: &[String]) {
        let mut items = self.items.lock().await;
        let mut remaining: Vec<QueuedMessage> = items.drain(..).collect();
        for id in ids {
            if let Some(pos) = remaining.iter().position(|m| &m.id == id) {
                items.push_back(remaining.remove(pos));
            }
        }
        // Append any leftovers not named in `ids`, in their existing order.
        for m in remaining {
            items.push_back(m);
        }
    }
}
