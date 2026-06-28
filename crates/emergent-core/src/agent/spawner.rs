use async_trait::async_trait;
use tokio::io::{AsyncRead, AsyncWrite};

/// A spawned agent process, providing stdin/stdout for the ACP byte stream.
#[async_trait]
pub trait AgentProcess: Send {
    type Stdin: AsyncWrite + Unpin + Send;
    type Stdout: AsyncRead + Unpin + Send;

    fn stdin(&mut self) -> &mut Self::Stdin;
    fn stdout(&mut self) -> &mut Self::Stdout;
    fn take_stdin(&mut self) -> Option<Self::Stdin>;
    fn take_stdout(&mut self) -> Option<Self::Stdout>;
    async fn kill(&mut self) -> Result<(), String>;
    async fn wait(&mut self) -> Result<std::process::ExitStatus, String>;
}

/// Strategy for spawning agent processes.
///
/// Agents run as local host processes: the CLI is launched directly with its
/// working directory set to the agent's home dir, and `HOME` (plus any other
/// overrides) supplied via `env` so per-agent config stays isolated.
#[async_trait]
pub trait ProcessSpawner: Send + Sync {
    type Process: AgentProcess;
    async fn spawn(
        &self,
        command: &[&str],
        cwd: &std::path::Path,
        env: &[(String, String)],
    ) -> Result<Self::Process, String>;
}

// ---------------------------------------------------------------------------
// LocalProcessSpawner — runs the agent CLI directly via tokio::process::Command
// ---------------------------------------------------------------------------

pub struct LocalProcess {
    child: tokio::process::Child,
    stdin: Option<tokio::process::ChildStdin>,
    stdout: Option<tokio::process::ChildStdout>,
    /// Process-group id (== child pid; the child leads its own group) so the
    /// whole tree — the CLI plus any `bunx`/`node` grandchildren — can be
    /// signalled together. `None` for test stubs / non-Unix.
    #[cfg_attr(not(unix), allow(dead_code))]
    pgid: Option<i32>,
}

impl LocalProcess {
    /// Construct a minimal stub for integration tests. The child is a real
    /// process (e.g. `true`) so `Child` is valid; stdin/stdout are not piped.
    pub fn new_for_test(child: tokio::process::Child) -> Self {
        Self {
            child,
            stdin: None,
            stdout: None,
            pgid: None,
        }
    }

    /// Graceful shutdown: SIGTERM the process group, wait up to `timeout`,
    /// then SIGKILL the group (and the child) if it has not exited.
    pub async fn shutdown(&mut self, timeout: std::time::Duration) -> Result<(), String> {
        self.signal_group("TERM").await;

        if tokio::time::timeout(timeout, self.child.wait())
            .await
            .is_err()
        {
            self.signal_group("KILL").await;
            let _ = self.child.kill().await;
        }
        Ok(())
    }

    /// Send a signal to the whole process group. No-op on non-Unix or when the
    /// pid is unavailable (already reaped).
    async fn signal_group(&self, signal: &str) {
        #[cfg(unix)]
        if let Some(pgid) = self.pgid {
            // A negative pid targets the entire process group.
            let _ = tokio::process::Command::new("kill")
                .arg(format!("-{signal}"))
                .arg(format!("-{pgid}"))
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .await;
        }
        #[cfg(not(unix))]
        let _ = signal;
    }
}

#[async_trait]
impl AgentProcess for LocalProcess {
    type Stdin = tokio::process::ChildStdin;
    type Stdout = tokio::process::ChildStdout;

    fn stdin(&mut self) -> &mut Self::Stdin {
        self.stdin.as_mut().expect("stdin already taken")
    }

    fn stdout(&mut self) -> &mut Self::Stdout {
        self.stdout.as_mut().expect("stdout already taken")
    }

    fn take_stdin(&mut self) -> Option<Self::Stdin> {
        self.stdin.take()
    }

    fn take_stdout(&mut self) -> Option<Self::Stdout> {
        self.stdout.take()
    }

    async fn kill(&mut self) -> Result<(), String> {
        self.signal_group("KILL").await;
        self.child
            .kill()
            .await
            .map_err(|e| format!("Failed to kill agent process: {}", e))
    }

    async fn wait(&mut self) -> Result<std::process::ExitStatus, String> {
        self.child
            .wait()
            .await
            .map_err(|e| format!("Failed to wait on agent process: {}", e))
    }
}

#[derive(Default)]
pub struct LocalProcessSpawner;

impl LocalProcessSpawner {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl ProcessSpawner for LocalProcessSpawner {
    type Process = LocalProcess;

    async fn spawn(
        &self,
        command: &[&str],
        cwd: &std::path::Path,
        env: &[(String, String)],
    ) -> Result<Self::Process, String> {
        let program = command
            .first()
            .ok_or_else(|| "Cannot spawn agent: empty command".to_string())?;

        let mut cmd = tokio::process::Command::new(program);
        cmd.args(&command[1..]);
        cmd.current_dir(cwd);
        for (key, value) in env {
            cmd.env(key, value);
        }
        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);

        // Put the agent in its own process group so we can later signal the
        // whole tree (the CLI plus any `bunx`/`node` grandchildren).
        #[cfg(unix)]
        cmd.process_group(0);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn agent '{}': {}", program, e))?;

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let pgid = child.id().map(|id| id as i32);

        Ok(LocalProcess {
            child,
            stdin,
            stdout,
            pgid,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn local_process_spawner_implements_trait() {
        let spawner = LocalProcessSpawner::new();
        fn assert_spawner<S: ProcessSpawner>(_s: &S) {}
        assert_spawner(&spawner);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn spawns_local_process_with_cwd_and_env() {
        let dir = std::env::temp_dir();
        let spawner = LocalProcessSpawner::new();
        let mut proc = spawner
            .spawn(
                &["true"],
                &dir,
                &[("HOME".to_string(), dir.to_string_lossy().into_owned())],
            )
            .await
            .expect("spawn true");
        let status = proc.wait().await.expect("wait");
        assert!(status.success());
    }
}
