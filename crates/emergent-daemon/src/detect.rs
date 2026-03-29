pub use emergent_protocol::{AgentInfo, KnownAgent};

/// Known agent CLIs: (display name, command binary, extra args, required binaries).
///
/// `requires` lists binaries that must be on PATH for the agent to be considered available.
/// If empty, the command binary itself is checked.
const KNOWN_AGENTS: &[(&str, &str, &[&str], &[&str])] = &[
    ("Claude Code", "bunx", &["@zed-industries/claude-agent-acp"], &["claude", "bunx"]),
    ("Codex", "bunx", &["@zed-industries/codex-acp"], &["codex", "bunx"]),
    ("Gemini", "gemini", &["--experimental-acp"], &[]),
    ("Kiro", "kiro-cli", &["acp"], &[]),
    ("OpenCode", "opencode", &["acp"], &[]),
];

fn build_command(binary: &str, args: &[&str]) -> String {
    if args.is_empty() {
        binary.to_string()
    } else {
        format!("{} {}", binary, args.join(" "))
    }
}

fn is_available(binary: &str, requires: &[&str]) -> bool {
    if requires.is_empty() {
        which::which(binary).is_ok()
    } else {
        requires.iter().all(|bin| which::which(bin).is_ok())
    }
}

/// Return all known agent types, marking which are installed.
pub fn known_agents() -> Vec<KnownAgent> {
    KNOWN_AGENTS
        .iter()
        .map(|&(name, binary, args, requires)| KnownAgent {
            name: name.to_string(),
            command: build_command(binary, args),
            available: is_available(binary, requires),
        })
        .collect()
}

/// Detect which known agent CLIs are installed on the system.
pub fn detect_agents() -> Vec<AgentInfo> {
    KNOWN_AGENTS
        .iter()
        .filter(|&&(_, binary, _, requires)| is_available(binary, requires))
        .map(|&(name, binary, args, _)| AgentInfo {
            name: name.to_string(),
            binary: build_command(binary, args),
            path: which::which(binary)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_agents_returns_vec() {
        let agents = detect_agents();
        assert!(agents.len() <= KNOWN_AGENTS.len());
    }

    #[test]
    fn agent_info_serializes() {
        let info = AgentInfo {
            name: "Test Agent".into(),
            binary: "test-agent".into(),
            path: "/usr/bin/test-agent".into(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("Test Agent"));
    }

    #[test]
    fn known_agents_returns_all() {
        let agents = known_agents();
        assert_eq!(agents.len(), KNOWN_AGENTS.len());
        assert_eq!(agents[0].name, "Claude Code");
        assert_eq!(agents[0].command, "bunx @zed-industries/claude-agent-acp");
        assert_eq!(agents[1].name, "Codex");
        assert_eq!(agents[1].command, "bunx @zed-industries/codex-acp");
        assert_eq!(agents[2].name, "Gemini");
        assert_eq!(agents[2].command, "gemini --experimental-acp");
        assert_eq!(agents[3].name, "Kiro");
        assert_eq!(agents[3].command, "kiro-cli acp");
        assert_eq!(agents[4].name, "OpenCode");
        assert_eq!(agents[4].command, "opencode acp");
    }

    #[test]
    fn known_agent_serializes() {
        let agent = KnownAgent {
            name: "Test".into(),
            command: "test-bin".into(),
            available: true,
        };
        let json = serde_json::to_string(&agent).unwrap();
        assert!(json.contains("\"available\":true"));
    }

    #[test]
    fn is_available_checks_all_requires() {
        // Nonexistent binaries should fail
        assert!(!is_available("nonexistent-xyz", &["nonexistent-xyz", "also-nonexistent"]));
        // Empty requires falls back to checking the binary itself
        assert!(!is_available("nonexistent-xyz", &[]));
    }
}
