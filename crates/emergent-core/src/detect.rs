pub use emergent_protocol::{AgentProvider, KnownAgent};

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
///
/// npm-delivered wrappers carry an explicit `@latest` tag. Without it `bunx`
/// happily reuses whatever it already has cached — that is how an install can
/// stay pinned to a long-superseded wrapper (and, transitively, to the older
/// agent binary that wrapper vendors). The tag forces registry resolution on
/// every spawn.
struct KnownAgentRow {
    name: &'static str,
    binary: &'static str,
    args: &'static [&'static str],
    requires: &'static [&'static str],
}

/// The catalog entry for a harness.
///
/// A `match` rather than a lookup table, so adding an [`AgentProvider`] variant
/// fails to compile until it has an entry here. That is what lets
/// [`command_for_provider`] be total instead of returning an `Option` that no
/// caller could sensibly handle.
const fn catalog(provider: AgentProvider) -> KnownAgentRow {
    match provider {
        AgentProvider::Claude => KnownAgentRow {
            name: "Claude Code",
            binary: "bunx",
            args: &["@agentclientprotocol/claude-agent-acp@latest"],
            requires: &["bunx"],
        },
        AgentProvider::Codex => KnownAgentRow {
            name: "Codex",
            binary: "bunx",
            args: &["@agentclientprotocol/codex-acp@latest"],
            requires: &["bunx"],
        },
        AgentProvider::Gemini => KnownAgentRow {
            name: "Gemini",
            binary: "gemini",
            args: &["--experimental-acp"],
            requires: &[],
        },
        AgentProvider::Kiro => KnownAgentRow {
            name: "Kiro",
            binary: "kiro-cli",
            args: &["acp"],
            requires: &[],
        },
        AgentProvider::Opencode => KnownAgentRow {
            name: "OpenCode",
            binary: "opencode",
            args: &["acp"],
            requires: &[],
        },
        #[cfg(feature = "test-support")]
        AgentProvider::Mock => KnownAgentRow {
            name: "Mock",
            binary: "mock-agent",
            args: &[],
            requires: &[],
        },
    }
}

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

/// Resolve the spawn command for a harness.
///
/// Agent definitions persist only their `provider`, never a command string.
/// Resolving at spawn time means a catalog change — a renamed npm package, an
/// added flag — reaches every existing agent on the next spawn instead of
/// applying to newly created ones alone.
pub fn command_for_provider(provider: AgentProvider) -> String {
    let row = catalog(provider);
    build_command(row.binary, row.args)
}

/// The catalog's display name for a harness (e.g. "Claude Code").
pub fn display_name_for_provider(provider: AgentProvider) -> &'static str {
    catalog(provider).name
}

/// Return all known agent types, checking availability on the host `PATH`.
pub fn known_agents_on_host() -> Vec<KnownAgent> {
    AgentProvider::ALL
        .iter()
        .map(|&provider| {
            let row = catalog(provider);
            let available = if row.requires.is_empty() {
                is_available_on_host(row.binary)
            } else {
                row.requires.iter().all(|bin| is_available_on_host(bin))
            };
            KnownAgent {
                name: row.name.to_string(),
                command: build_command(row.binary, row.args),
                available,
                provider,
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
        assert_eq!(agents.len(), AgentProvider::ALL.len());
        assert_eq!(agents[0].name, "Claude Code");
        assert_eq!(
            agents[0].command,
            "bunx @agentclientprotocol/claude-agent-acp@latest"
        );
    }

    #[test]
    fn command_for_provider_resolves_each_harness() {
        assert_eq!(
            command_for_provider(AgentProvider::Codex),
            "bunx @agentclientprotocol/codex-acp@latest"
        );
        assert_eq!(
            command_for_provider(AgentProvider::Gemini),
            "gemini --experimental-acp"
        );
        assert_eq!(
            display_name_for_provider(AgentProvider::Claude),
            "Claude Code"
        );
    }

    /// `ALL` is hand-written, so it can drift from the enum. Every variant that
    /// deserializes must appear in it, or it silently vanishes from the catalog.
    #[test]
    fn all_providers_is_exhaustive() {
        for &provider in AgentProvider::ALL {
            let encoded = serde_json::to_string(&provider).unwrap();
            let decoded: AgentProvider = serde_json::from_str(&encoded).unwrap();
            assert_eq!(decoded, provider);
        }

        let distinct: std::collections::HashSet<_> = AgentProvider::ALL.iter().collect();
        assert_eq!(
            distinct.len(),
            AgentProvider::ALL.len(),
            "AgentProvider::ALL lists a variant twice"
        );

        // Mirrors the variant count; bump deliberately when adding a harness so
        // a new variant cannot be added to the enum but omitted from `ALL`.
        #[cfg(not(feature = "test-support"))]
        assert_eq!(AgentProvider::ALL.len(), 5);
        #[cfg(feature = "test-support")]
        assert_eq!(AgentProvider::ALL.len(), 6);
    }

    /// An unknown harness id must be rejected at parse time rather than
    /// persisting cleanly and failing later at spawn.
    #[test]
    fn unknown_provider_fails_to_deserialize() {
        assert!(serde_json::from_str::<AgentProvider>("\"kodex\"").is_err());
        assert!(serde_json::from_str::<AgentProvider>("\"\"").is_err());
    }

    /// npm-delivered wrappers must stay tagged, or bunx serves a stale cache.
    #[test]
    fn bunx_delivered_agents_pin_latest() {
        for &provider in AgentProvider::ALL {
            let row = catalog(provider);
            if row.binary != "bunx" {
                continue;
            }
            assert!(
                row.args.iter().any(|a| a.ends_with("@latest")),
                "{} is delivered via bunx but does not request @latest",
                row.name
            );
        }
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
            provider: AgentProvider::Claude,
        };
        let json = serde_json::to_string(&agent).unwrap();
        assert!(json.contains("\"available\":true"));
        assert!(json.contains("\"provider\":\"claude\""));
    }
}
