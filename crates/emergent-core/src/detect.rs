pub use emergent_protocol::KnownAgent;

/// The process `PATH` enriched with the common CLI install locations that GUI
/// launches often miss (login-shell-only dirs like `~/.local/bin`, `~/.cargo/bin`,
/// `/opt/homebrew/bin`, …), computed once and cached.
///
/// Used to detect agent CLIs (`which_in`) and as the `PATH` handed to spawned
/// agent processes AND interactive terminal shells. It does NOT mutate the global
/// environment: `set_var("PATH", …)` is a data race against any concurrent
/// getenv/setenv (the env is process-global, unsynchronized) and would silently
/// leak into every child. Instead the enriched value is passed explicitly where
/// it's needed.
pub(crate) fn enriched_path() -> &'static str {
    use std::path::PathBuf;
    use std::sync::OnceLock;

    static ENRICHED: OnceLock<String> = OnceLock::new();
    ENRICHED.get_or_init(|| {
        let current = std::env::var("PATH").unwrap_or_default();
        let mut dirs: Vec<PathBuf> = std::env::split_paths(&current).collect();

        let mut extra: Vec<PathBuf> = Vec::new();
        if let Ok(home) = std::env::var("HOME") {
            let home = PathBuf::from(home);
            extra.push(home.join(".local/bin"));
            extra.push(home.join(".cargo/bin"));
            extra.push(home.join(".bun/bin"));
            extra.push(home.join(".nvm/current/bin"));
            extra.push(home.join(".local/share/fnm/aliases/default/bin"));
        }
        extra.push(PathBuf::from("/usr/local/bin"));
        extra.push(PathBuf::from("/opt/homebrew/bin"));

        for dir in extra {
            if dir.is_dir() && !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }

        std::env::join_paths(&dirs)
            .ok()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or(current)
    })
}

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
        &["@agentclientprotocol/claude-agent-acp"],
        &["bunx"],
        "claude",
    ),
    (
        "Codex",
        "bunx",
        &["@agentclientprotocol/codex-acp"],
        &["bunx"],
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

/// Whether a binary is resolvable on the enriched host `PATH`.
///
/// Uses `which_in` against [`crate::agent::enriched_path`] so detection sees the
/// same login-shell install dirs the spawned agents get — without relying on a
/// globally mutated `PATH`.
fn is_available_on_host(binary: &str) -> bool {
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    which::which_in(binary, Some(enriched_path()), cwd).is_ok()
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
        assert_eq!(
            agents[0].command,
            "bunx @agentclientprotocol/claude-agent-acp"
        );
    }

    #[test]
    fn enriched_path_is_a_superset_and_does_not_mutate_global_env() {
        let before = std::env::var("PATH").unwrap_or_default();

        let enriched = enriched_path();
        let enriched_dirs: Vec<_> = std::env::split_paths(enriched).collect();

        // Every entry of the original PATH is preserved (enrichment only appends).
        for dir in std::env::split_paths(&before) {
            assert!(
                enriched_dirs.contains(&dir),
                "enriched PATH dropped original entry {:?}",
                dir
            );
        }

        // The global PATH must be untouched — the whole point of not using set_var.
        assert_eq!(std::env::var("PATH").unwrap_or_default(), before);
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
