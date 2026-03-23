pub use emergent_protocol::{AgentInfo, KnownAgent};

/// Known agent CLIs: (display name, binary, extra args).
const KNOWN_AGENTS: &[(&str, &str, &[&str])] = &[
    ("Claude Code", "claude-agent-acp", &[]),
    ("Codex", "codex-acp", &[]),
    ("Gemini", "gemini", &["--experimental-acp"]),
    ("Kiro", "kiro-cli", &["acp"]),
    ("OpenCode", "opencode", &["acp"]),
];

/// Return all known agent types, marking which are installed.
pub fn known_agents() -> Vec<KnownAgent> {
    KNOWN_AGENTS
        .iter()
        .map(|&(name, binary, args)| {
            let command = if args.is_empty() {
                binary.to_string()
            } else {
                format!("{} {}", binary, args.join(" "))
            };
            KnownAgent {
                name: name.to_string(),
                command,
                available: which::which(binary).is_ok(),
            }
        })
        .collect()
}

/// Detect which known agent CLIs are installed on the system.
pub fn detect_agents() -> Vec<AgentInfo> {
    let mut found = Vec::new();
    for &(name, binary, _args) in KNOWN_AGENTS {
        if let Ok(path) = which::which(binary) {
            found.push(AgentInfo {
                name: name.to_string(),
                binary: binary.to_string(),
                path: path.to_string_lossy().to_string(),
            });
        }
    }
    found
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
        assert_eq!(agents[0].command, "claude-agent-acp");
        assert_eq!(agents[1].name, "Codex");
        assert_eq!(agents[1].command, "codex-acp");
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
}
