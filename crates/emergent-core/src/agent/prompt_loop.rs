use std::sync::Arc;

use emergent_protocol::{
    AgentStatus, Notification, StatusChangePayload, SystemMessagePayload, UserMessagePayload,
};
use tokio::sync::{broadcast, oneshot, Mutex};

use super::{AgentCommand, ThreadHandle};
use crate::swarm::build_system_block;

/// Per-thread prompt loop. Owns the prompt lifecycle for a single thread.
/// Wakes on `Notify`, checks for a queued user prompt, constructs the prompt,
/// and sends it to the ACP command loop.
pub(crate) async fn prompt_loop(
    agent_id: String,
    handle_arc: Arc<Mutex<ThreadHandle>>,
    event_tx: broadcast::Sender<Notification>,
) {
    // Grab the Notify from the handle (it's Arc-wrapped, so clone is cheap).
    let notify = handle_arc.lock().await.prompt_notify.clone();

    loop {
        // Phase 1: Check for work — take pending prompt.
        let pending = {
            let mut handle = handle_arc.lock().await;
            handle.pending_prompt.take()
        };

        // If no work, wait for a notification.
        if pending.is_none() {
            notify.notified().await;
            continue; // Re-check after waking.
        }

        // Phase 2: Build prompt text.
        let (user_text, reply_tx) = match pending {
            Some((text, reply)) => (text, Some(reply)),
            None => (String::new(), None),
        };

        // Determine injection parameters
        let (is_first_turn, role, permission_change) = {
            let handle = handle_arc.lock().await;
            let first = !handle.has_prompted;
            let role_ref = if first { handle.role.clone() } else { None };
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
            (first, role_ref, perm_change)
        };

        // Build the system block (mailbox disconnected — always pass 0)
        let system_block = build_system_block(
            is_first_turn,
            role.as_deref(),
            permission_change.as_deref(),
            0,
        );

        // Emit permission change system message to frontend
        if let Some(ref perm_msg) = permission_change {
            let _ = event_tx.send(Notification::SystemMessage(SystemMessagePayload {
                agent_id: agent_id.clone(),
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

        // Edge case: empty prompt (shouldn't happen with mailbox disconnected,
        // but guard against it).
        if prompt_text.is_empty() {
            if let Some(reply) = reply_tx {
                let _ = reply.send(Err("Empty prompt".to_string()));
            }
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

                // Emit UserMessage for non-empty user text.
                if !user_text.is_empty() {
                    let _ = event_tx.send(Notification::UserMessage(UserMessagePayload {
                        agent_id: agent_id.clone(),
                        content: user_text.clone(),
                    }));
                }

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
                }
                Err(_) => {
                    handle.status = AgentStatus::Error;
                    let _ = event_tx.send(Notification::StatusChange(StatusChangePayload {
                        agent_id: agent_id.clone(),
                        status: AgentStatus::Error.to_string(),
                    }));
                }
            }
        }

        // Phase 5: Send result back to caller (if this was a user-initiated prompt).
        if let Some(reply) = reply_tx {
            let _ = reply.send(send_result);
        }

        // Loop back — immediately re-check for more work.
    }
}
