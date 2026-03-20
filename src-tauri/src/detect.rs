use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AgentInfo {
    pub name: String,
    pub binary: String,
    pub path: String,
}

/// Known agent CLIs and their binary names.
const KNOWN_AGENTS: &[(&str, &str)] = &[
    ("Claude Code", "claude-agent-acp"),
    ("Codex", "codex-acp"),
];

#[derive(Debug, Clone, Serialize)]
pub struct KnownAgent {
    pub name: String,
    pub binary: String,
    pub available: bool,
}

/// Return all known agent types, marking which are installed.
pub fn known_agents() -> Vec<KnownAgent> {
    KNOWN_AGENTS
        .iter()
        .map(|&(name, binary)| KnownAgent {
            name: name.to_string(),
            binary: binary.to_string(),
            available: which::which(binary).is_ok(),
        })
        .collect()
}

/// Detect which known agent CLIs are installed on the system.
pub fn detect_agents() -> Vec<AgentInfo> {
    let mut found = Vec::new();
    for &(name, binary) in KNOWN_AGENTS {
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
        // Should return a Vec (possibly empty if claude-agent-acp not installed)
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
        assert_eq!(agents[0].binary, "claude-agent-acp");
        assert_eq!(agents[1].name, "Codex");
        assert_eq!(agents[1].binary, "codex-acp");
    }

    #[test]
    fn known_agent_serializes() {
        let agent = KnownAgent {
            name: "Test".into(),
            binary: "test-bin".into(),
            available: true,
        };
        let json = serde_json::to_string(&agent).unwrap();
        assert!(json.contains("\"available\":true"));
    }
}
