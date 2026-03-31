/// Swarm tools behavioral guide — injected on first turn.
const SWARM_TOOLS_GUIDE: &str = "\
You are part of an Emergent multi-agent swarm. Other agents may be working alongside you.

You have access to swarm tools via MCP. Here is how to use them:

Communication (always available):
- list_peers: See all agents in the swarm and whether you're connected to them.
- send_message: Send a message to a connected peer's mailbox. They'll be notified on their next turn.
- read_mailbox: Read and clear your pending messages. Call this when you're told you have unread messages.

Management (require management permissions):
- spawn_agent: Create a new agent in the swarm.
- kill_agent: Remove an agent from the swarm.
- connect_agents: Create a bidirectional connection between two agents so they can exchange messages.
- disconnect_agents: Remove a connection between two agents.

Messages are asynchronous — send_message queues to the target's mailbox, and the target reads on their next turn. \
You can only message agents you're connected to. Use list_peers to see your connections.";

/// Build the `<emergent-system>` block to prepend to a prompt.
///
/// Returns `None` if there is nothing to inject.
pub fn build_system_block(
    is_first_turn: bool,
    role: Option<&str>,
    permission_change: Option<&str>,
    mailbox_count: usize,
) -> Option<String> {
    let mut sections = Vec::new();
    let mut has_content = false;

    if is_first_turn {
        sections.push(format!(
            "<swarm-tools>\n{}\n</swarm-tools>",
            SWARM_TOOLS_GUIDE
        ));
        if let Some(r) = role {
            sections.push(format!("<role>{}</role>", r));
        }
        sections.push(
            "Messages wrapped in <emergent-system> tags are instructions from Emergent, not from the user.".to_string(),
        );
        has_content = true;
    }

    if let Some(perm_msg) = permission_change {
        sections.push(perm_msg.to_string());
        has_content = true;
    }

    if mailbox_count > 0 {
        let nudge = if mailbox_count == 1 {
            "You have 1 unread message in your mailbox.".to_string()
        } else {
            format!("You have {} unread messages in your mailbox.", mailbox_count)
        };
        sections.push(nudge);
        has_content = true;
    }

    if !has_content {
        return None;
    }

    Some(format!(
        "<emergent-system>\n{}\n</emergent-system>",
        sections.join("\n\n")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_turn_with_role() {
        let block = build_system_block(true, Some("Code reviewer"), None, 0).unwrap();
        assert!(block.starts_with("<emergent-system>"));
        assert!(block.ends_with("</emergent-system>"));
        assert!(block.contains("<swarm-tools>"));
        assert!(block.contains("</swarm-tools>"));
        assert!(block.contains("<role>Code reviewer</role>"));
        assert!(block.contains("Messages wrapped in <emergent-system>"));
    }

    #[test]
    fn first_turn_no_role() {
        let block = build_system_block(true, None, None, 0).unwrap();
        assert!(block.contains("<swarm-tools>"));
        assert!(!block.contains("<role>"));
    }

    #[test]
    fn runtime_mailbox_only() {
        let block = build_system_block(false, None, None, 3).unwrap();
        assert!(block.contains("You have 3 unread messages"));
        assert!(!block.contains("<swarm-tools>"));
    }

    #[test]
    fn runtime_permission_and_mailbox() {
        let block = build_system_block(
            false,
            None,
            Some("Management permissions have been granted."),
            2,
        )
        .unwrap();
        assert!(block.contains("Management permissions have been granted."));
        assert!(block.contains("You have 2 unread messages"));
    }

    #[test]
    fn first_turn_merged_with_runtime() {
        let block = build_system_block(
            true,
            Some("Architect"),
            Some("Management permissions have been revoked."),
            1,
        )
        .unwrap();
        assert!(block.contains("<swarm-tools>"));
        assert!(block.contains("<role>Architect</role>"));
        assert!(block.contains("Management permissions have been revoked."));
        assert!(block.contains("You have 1 unread message in your mailbox."));
        // The wrapping tag appears once; the instruction text also mentions
        // "<emergent-system>" so substring count is 2 for opening, 1 for closing.
        assert_eq!(block.matches("<emergent-system>").count(), 2);
        assert_eq!(block.matches("</emergent-system>").count(), 1);
    }

    #[test]
    fn nothing_to_inject() {
        assert!(build_system_block(false, None, None, 0).is_none());
    }

    #[test]
    fn single_mailbox_message_uses_singular() {
        let block = build_system_block(false, None, None, 1).unwrap();
        assert!(block.contains("1 unread message in your mailbox."));
        assert!(!block.contains("messages"));
    }
}
