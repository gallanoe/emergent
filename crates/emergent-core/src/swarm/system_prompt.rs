/// Swarm awareness guide — injected on first turn.
const SWARM_GUIDE: &str = "\
You are part of an Emergent multi-agent swarm. Other agents may be working alongside you in the same workspace.";

/// Task-session tool guide — injected on first turn of a task session.
const TASK_SESSION_GUIDE: &str = "\
You are running as a task session. Two additional tools are available to you:

- `update_task`: Call this whenever you make meaningful progress. The `description` argument is shown to the session that created this task. Use it to report intermediate results, decisions, or status updates.
- `complete_task`: Marks this task as done. Accepts an optional `summary` parameter — use it to tell the creator what was accomplished. Your session ends after the turn in which you call `complete_task`.";

/// Build the `<emergent-system>` block to prepend to a prompt.
///
/// Returns `None` if there is nothing to inject.
pub fn build_system_block(
    is_first_turn: bool,
    is_task_session: bool,
    permission_change: Option<&str>,
) -> Option<String> {
    let mut sections = Vec::new();
    let mut has_content = false;

    if is_first_turn {
        sections.push(SWARM_GUIDE.to_string());
        sections.push(
            "Messages wrapped in <emergent-system> tags are instructions from Emergent, not from the user.".to_string(),
        );
        if is_task_session {
            sections.push(TASK_SESSION_GUIDE.to_string());
        }
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
    fn first_turn() {
        let block = build_system_block(true, false, None).unwrap();
        assert!(block.starts_with("<emergent-system>"));
        assert!(block.ends_with("</emergent-system>"));
        assert!(block.contains("multi-agent swarm"));
        assert!(block.contains("Messages wrapped in <emergent-system>"));
    }

    #[test]
    fn runtime_permission_only() {
        let block = build_system_block(
            false,
            false,
            Some("Management permissions have been granted."),
        )
        .unwrap();
        assert!(block.contains("Management permissions have been granted."));
        assert!(!block.contains("multi-agent swarm"));
    }

    #[test]
    fn first_turn_merged_with_permission() {
        let block = build_system_block(
            true,
            false,
            Some("Management permissions have been revoked."),
        )
        .unwrap();
        assert!(block.contains("multi-agent swarm"));
        assert!(block.contains("Management permissions have been revoked."));
        // The wrapping tag appears once; the instruction text also mentions
        // "<emergent-system>" so substring count is 2 for opening, 1 for closing.
        assert_eq!(block.matches("<emergent-system>").count(), 2);
        assert_eq!(block.matches("</emergent-system>").count(), 1);
    }

    #[test]
    fn nothing_to_inject() {
        assert!(build_system_block(false, false, None).is_none());
    }

    #[test]
    fn task_session_first_turn_includes_update_task_and_summary() {
        let block = build_system_block(true, true, None).unwrap();
        assert!(
            block.contains("update_task"),
            "task session block must mention update_task"
        );
        assert!(
            block.contains("summary"),
            "task session block must mention summary"
        );
    }

    #[test]
    fn non_task_session_first_turn_omits_task_tools() {
        let block = build_system_block(true, false, None).unwrap();
        assert!(
            !block.contains("update_task"),
            "non-task session block must not mention update_task"
        );
        assert!(
            !block.contains("summary"),
            "non-task session block must not mention summary"
        );
    }
}
