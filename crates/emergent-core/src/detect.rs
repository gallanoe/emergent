pub use emergent_protocol::KnownAgent;

/// Known agent CLIs: (display name, binary, args, required-on-PATH bins, provider id).
///
/// `requires` lists binaries that must be resolvable on the host `PATH`. If
/// empty, the command binary itself is checked.
type KnownAgentRow = (
    &'static str,
    &'static str,
    &'static [&'static str],
    &'static [&'static str],
    &'static str,
);
const KNOWN_AGENTS: &[KnownAgentRow] = &[
    (
        "Claude Code",
        "bunx",
        &["@zed-industries/claude-agent-acp"],
        &["claude", "bunx"],
        "claude",
    ),
    (
        "Codex",
        "bunx",
        &["@zed-industries/codex-acp"],
        &["codex", "bunx"],
        "codex",
    ),
    ("Gemini", "gemini", &["--experimental-acp"], &[], "gemini"),
    ("Kiro", "kiro-cli", &["acp"], &[], "kiro"),
    ("OpenCode", "opencode", &["acp"], &[], "opencode"),
];

fn build_command(binary: &str, args: &[&str]) -> String {
    if args.is_empty() {
        binary.to_string()
    } else {
        format!("{} {}", binary, args.join(" "))
    }
}

/// Whether a binary is resolvable on the host `PATH`.
fn is_available_on_host(binary: &str) -> bool {
    which::which(binary).is_ok()
}

/// Return all known agent types, checking availability on the host `PATH`.
pub fn known_agents_on_host() -> Vec<KnownAgent> {
    KNOWN_AGENTS
        .iter()
        .map(|&(name, binary, args, requires, provider)| {
            let available = if requires.is_empty() {
                is_available_on_host(binary)
            } else {
                requires.iter().all(|bin| is_available_on_host(bin))
            };
            KnownAgent {
                name: name.to_string(),
                command: build_command(binary, args),
                available,
                provider: provider.to_string(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_agents_on_host_returns_all() {
        let agents = known_agents_on_host();
        assert_eq!(agents.len(), KNOWN_AGENTS.len());
        assert_eq!(agents[0].name, "Claude Code");
        assert_eq!(agents[0].command, "bunx @zed-industries/claude-agent-acp");
    }

    #[test]
    fn known_agent_serializes() {
        let agent = KnownAgent {
            name: "Test".into(),
            command: "test-bin".into(),
            available: true,
            provider: "claude".into(),
        };
        let json = serde_json::to_string(&agent).unwrap();
        assert!(json.contains("\"available\":true"));
    }
}
