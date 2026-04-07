// TODO: Update swarm tools guide to reflect the agent/session refactor.
// The tool names and descriptions here are stale — MCP tools were removed
// and need to be redesigned for the new session-based model.
/// Swarm tools behavioral guide — injected on first turn.
const SWARM_TOOLS_GUIDE: &str = "\
You are part of an Emergent multi-agent swarm. Other agents may be working alongside you.

You have access to swarm tools via MCP. Here is how to use them:

- list_peers: See all agents in the swarm and whether you're connected to them.
- kill_agent: Remove an agent from the swarm (requires management permissions).
- connect_agents: Create a bidirectional connection between two agents (requires management permissions).
- disconnect_agents: Remove a connection between two agents (requires management permissions).";

/// Build the `<emergent-system>` block to prepend to a prompt.
///
/// Returns `None` if there is nothing to inject.
pub fn build_system_block(
    is_first_turn: bool,
    role: Option<&str>,
    permission_change: Option<&str>,
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
        let block = build_system_block(true, Some("Code reviewer"), None).unwrap();
        assert!(block.starts_with("<emergent-system>"));
        assert!(block.ends_with("</emergent-system>"));
        assert!(block.contains("<swarm-tools>"));
        assert!(block.contains("</swarm-tools>"));
        assert!(block.contains("<role>Code reviewer</role>"));
        assert!(block.contains("Messages wrapped in <emergent-system>"));
    }

    #[test]
    fn first_turn_no_role() {
        let block = build_system_block(true, None, None).unwrap();
        assert!(block.contains("<swarm-tools>"));
        assert!(!block.contains("<role>"));
    }

    #[test]
    fn runtime_permission_only() {
        let block = build_system_block(
            false,
            None,
            Some("Management permissions have been granted."),
        )
        .unwrap();
        assert!(block.contains("Management permissions have been granted."));
        assert!(!block.contains("<swarm-tools>"));
    }

    #[test]
    fn first_turn_merged_with_permission() {
        let block = build_system_block(
            true,
            Some("Architect"),
            Some("Management permissions have been revoked."),
        )
        .unwrap();
        assert!(block.contains("<swarm-tools>"));
        assert!(block.contains("<role>Architect</role>"));
        assert!(block.contains("Management permissions have been revoked."));
        // The wrapping tag appears once; the instruction text also mentions
        // "<emergent-system>" so substring count is 2 for opening, 1 for closing.
        assert_eq!(block.matches("<emergent-system>").count(), 2);
        assert_eq!(block.matches("</emergent-system>").count(), 1);
    }

    #[test]
    fn nothing_to_inject() {
        assert!(build_system_block(false, None, None).is_none());
    }

}
