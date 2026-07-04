use std::sync::Arc;

use emergent_protocol::{
    AgentStatus, Notification, QueueChangedPayload, StatusChangePayload, SystemMessagePayload,
};
use tokio::sync::{broadcast, oneshot, Mutex};

use super::queue::ThreadQueue;
use super::{AgentCommand, ThreadHandle};
use crate::swarm::build_system_block;

/// Per-thread prompt loop. Owns the prompt lifecycle for a single thread.
/// Wakes on the queue's `Notify`, drains the **whole** queue into one coalesced
/// turn (each message rendered with a source-appropriate header), constructs the
/// prompt, and sends it to the ACP command loop. Draining is the only place the
/// idle gate applies: messages may be enqueued in any state and are held here
/// until the thread is idle and this loop picks them up.
pub(crate) async fn prompt_loop(
    agent_id: String,
    handle_arc: Arc<Mutex<ThreadHandle>>,
    queue: Arc<ThreadQueue>,
    event_tx: broadcast::Sender<Notification>,
) {
    loop {
        // Phase 1: wait for work. Drain the entire queue in one shot so all
        // currently-pending messages coalesce into a single turn.
        let pending = queue.drain_all().await;
        let Some(messages) = pending else {
            queue.notify.notified().await;
            continue; // Re-check after waking.
        };

        // The queue is now empty — tell the frontend so its chip stack clears.
        let _ = event_tx.send(Notification::QueueChanged(QueueChangedPayload {
            thread_id: agent_id.clone(),
            items: Vec::new(),
        }));

        // Phase 2: render + coalesce the drained messages into the user text.
        let user_text = messages
            .iter()
            .map(|m| m.render())
            .collect::<Vec<_>>()
            .join("\n\n");

        // Determine injection parameters.
        let (is_first_turn, is_task_session, permission_change) = {
            let handle = handle_arc.lock().await;
            let first = !handle.has_prompted;
            let task_session = handle.task_id.is_some();
            let perm_change =
                if handle.has_management_permissions != handle.last_prompted_permissions {
                    let msg = if handle.has_management_permissions {
                        "Management permissions have been granted."
                    } else {
                        "Management permissions have been revoked."
                    };
                    Some(msg.to_string())
                } else {
                    None
                };
            (first, task_session, perm_change)
        };

        let system_block =
            build_system_block(is_first_turn, is_task_session, permission_change.as_deref());

        // Emit permission change system message to frontend
        if let Some(ref perm_msg) = permission_change {
            let _ = event_tx.send(Notification::SystemMessage(SystemMessagePayload {
                thread_id: agent_id.clone(),
                content: perm_msg.clone(),
            }));
        }

        // Combine system block + user text
        let prompt_text = match (system_block, user_text.is_empty()) {
            (Some(block), true) => block,
            (Some(block), false) => format!("{}\n\n{}", block, user_text),
            (None, false) => user_text.clone(),
            (None, true) => String::new(),
        };

        // Edge case: empty prompt — guard against it.
        if prompt_text.is_empty() {
            continue;
        }

        // Update state flags
        {
            let mut handle = handle_arc.lock().await;
            if !handle.has_prompted {
                handle.has_prompted = true;
            }
            handle.last_prompted_permissions = handle.has_management_permissions;
        }

        // Phase 3: Set status to Working and send the prompt.
        let send_result = {
            let mut handle = handle_arc.lock().await;
            if handle.status != AgentStatus::Idle {
                Err(format!(
                    "Agent '{}' is not idle (current status: {})",
                    agent_id, handle.status
                ))
            } else {
                handle.status = AgentStatus::Working;

                let (prompt_reply_tx, prompt_reply_rx) = oneshot::channel();
                let cmd_result = handle.command_tx.send(AgentCommand::Prompt {
                    text: prompt_text,
                    reply: prompt_reply_tx,
                });

                match cmd_result {
                    Ok(()) => {
                        drop(handle); // Release lock while waiting.
                        prompt_reply_rx
                            .await
                            .unwrap_or(Err("Agent thread terminated during prompt".to_string()))
                    }
                    Err(_) => Err("Agent thread has terminated".to_string()),
                }
            }
        };

        // Phase 4: Update status based on result.
        {
            let mut handle = handle_arc.lock().await;
            match &send_result {
                Ok(()) => {
                    handle.status = AgentStatus::Idle;
                    let _ = event_tx.send(Notification::StatusChange(StatusChangePayload {
                        thread_id: agent_id.clone(),
                        status: AgentStatus::Idle.to_string(),
                    }));
                }
                Err(_) => {
                    handle.status = AgentStatus::Error;
                    let _ = event_tx.send(Notification::StatusChange(StatusChangePayload {
                        thread_id: agent_id.clone(),
                        status: AgentStatus::Error.to_string(),
                    }));
                }
            }
        }

        // Loop back — immediately re-check for more work.
    }
}
