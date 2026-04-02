pub use emergent_protocol::KnownAgent;

use bollard::exec::{CreateExecOptions, StartExecResults};
use bollard::Docker;
use futures_util::StreamExt;

/// Known agent CLIs: (display name, command binary, extra args, required binaries).
///
/// `requires` lists binaries that must be findable via `which` inside the container.
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

/// Check if a binary exists inside a running container via `which`.
async fn is_available_in_container(docker: &Docker, container_id: &str, binary: &str) -> bool {
    let exec = docker
        .create_exec(
            container_id,
            CreateExecOptions {
                cmd: Some(vec!["which", binary]),
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                ..Default::default()
            },
        )
        .await;

    let exec_id = match exec {
        Ok(resp) => resp.id,
        Err(_) => return false,
    };

    // Start exec and drain the output stream to wait for completion
    match docker.start_exec(&exec_id, None).await {
        Ok(StartExecResults::Attached { mut output, .. }) => {
            while output.next().await.is_some() {}
        }
        Ok(StartExecResults::Detached) => {}
        Err(_) => return false,
    }

    // Now inspect — exec is finished, exit_code will be set
    match docker.inspect_exec(&exec_id).await {
        Ok(info) => info.exit_code == Some(0),
        Err(_) => false,
    }
}

/// Return all known agent types, checking availability inside a container.
pub async fn known_agents_in_container(
    docker: &Docker,
    container_id: &str,
) -> Vec<KnownAgent> {
    let mut agents = Vec::new();

    for &(name, binary, args, requires) in KNOWN_AGENTS {
        let available = if requires.is_empty() {
            is_available_in_container(docker, container_id, binary).await
        } else {
            let mut all_ok = true;
            for bin in requires {
                if !is_available_in_container(docker, container_id, bin).await {
                    all_ok = false;
                    break;
                }
            }
            all_ok
        };

        agents.push(KnownAgent {
            name: name.to_string(),
            command: build_command(binary, args),
            available,
        });
    }

    agents
}

/// Return all known agent types with `available: false` (no container running).
pub fn known_agents_unavailable() -> Vec<KnownAgent> {
    KNOWN_AGENTS
        .iter()
        .map(|&(name, binary, args, _)| KnownAgent {
            name: name.to_string(),
            command: build_command(binary, args),
            available: false,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_agents_unavailable_returns_all() {
        let agents = known_agents_unavailable();
        assert_eq!(agents.len(), KNOWN_AGENTS.len());
        assert_eq!(agents[0].name, "Claude Code");
        assert_eq!(agents[0].command, "bunx @zed-industries/claude-agent-acp");
        assert!(agents.iter().all(|a| !a.available));
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
