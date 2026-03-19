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
];

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
}
