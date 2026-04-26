use async_trait::async_trait;
use tokio::io::{AsyncRead, AsyncWrite};

/// A process running inside a container, providing stdin/stdout for ACP.
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

/// Strategy for spawning agent processes inside containers.
///
/// When `pid_file` is `Some`, the spawner wraps the command with a shell
/// that records the in-container PID before exec'ing the binary, so the
/// process can be killed directly via `<runtime> exec <container> kill <pid>`.
/// `<runtime> exec -i` does not forward signals from the host-side client
/// to the in-container process, so killing the host client alone leaks.
#[async_trait]
pub trait ProcessSpawner: Send + Sync {
    type Process: AgentProcess;
    async fn spawn(
        &self,
        container_id: &str,
        command: &[&str],
        workdir: Option<&str>,
        pid_file: Option<&str>,
    ) -> Result<Self::Process, String>;
}

fn sh_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

// ---------------------------------------------------------------------------
// RuntimeCliSpawner — uses `<runtime> exec -i` via tokio::process::Command
// ---------------------------------------------------------------------------

pub struct RuntimeCliProcess {
    child: tokio::process::Child,
    stdin: Option<tokio::process::ChildStdin>,
    stdout: Option<tokio::process::ChildStdout>,
    cli_program: String,
    container_id: String,
    pid_file: Option<String>,
}

impl RuntimeCliProcess {
    /// Construct a minimal stub `RuntimeCliProcess` for integration tests.
    /// The child is a real process (`true`) so `Child` is valid, but stdin/stdout
    /// are not piped and the cli_program/container_id are empty sentinels.
    pub fn new_for_test(child: tokio::process::Child) -> Self {
        Self {
            child,
            stdin: None,
            stdout: None,
            cli_program: String::new(),
            container_id: String::new(),
            pid_file: None,
        }
    }

    /// Graceful shutdown: kill the in-container process via its recorded PID,
    /// then wait for the host-side exec client to exit (force-killing it on
    /// timeout). Necessary because `<runtime> exec -i` does not forward
    /// signals — killing only the host client leaks the container process.
    pub async fn shutdown(&mut self, timeout: std::time::Duration) -> Result<(), String> {
        if let Some(pf) = &self.pid_file {
            let script = format!(
                "PID=$(cat {pf} 2>/dev/null); \
                 if [ -n \"$PID\" ]; then \
                   kill -TERM \"$PID\" 2>/dev/null; \
                   sleep 0.3; \
                   kill -KILL \"$PID\" 2>/dev/null; \
                 fi; \
                 rm -f {pf}",
                pf = pf,
            );
            // Fire-and-forget. `kill_on_drop` would SIGKILL this exec client
            // the moment `_child` goes out of scope below — before the kill
            // script runs — so leave it off. If our app exits before the
            // script finishes, the client is reparented to init and runs to
            // completion.
            match tokio::process::Command::new(&self.cli_program)
                .arg("exec")
                .arg(&self.container_id)
                .arg("sh")
                .arg("-c")
                .arg(&script)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
            {
                Ok(_child) => {}
                Err(e) => log::warn!("in-container kill failed to spawn: {}", e),
            }
        }

        if tokio::time::timeout(timeout, self.child.wait()).await.is_err() {
            let _ = self.child.kill().await;
        }
        Ok(())
    }
}

#[async_trait]
impl AgentProcess for RuntimeCliProcess {
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
        self.child
            .kill()
            .await
            .map_err(|e| format!("Failed to kill runtime exec process: {}", e))
    }

    async fn wait(&mut self) -> Result<std::process::ExitStatus, String> {
        self.child
            .wait()
            .await
            .map_err(|e| format!("Failed to wait on runtime exec process: {}", e))
    }
}

pub struct RuntimeCliSpawner {
    cli_program: String,
}

impl RuntimeCliSpawner {
    pub fn new(cli_program: impl Into<String>) -> Self {
        Self {
            cli_program: cli_program.into(),
        }
    }
}

#[async_trait]
impl ProcessSpawner for RuntimeCliSpawner {
    type Process = RuntimeCliProcess;

    async fn spawn(
        &self,
        container_id: &str,
        command: &[&str],
        workdir: Option<&str>,
        pid_file: Option<&str>,
    ) -> Result<Self::Process, String> {
        let mut cmd = tokio::process::Command::new(&self.cli_program);
        cmd.arg("exec").arg("-i");
        if let Some(dir) = workdir {
            cmd.arg("-w").arg(dir);
        }
        cmd.arg(container_id);

        match pid_file {
            Some(pf) => {
                let inner = command
                    .iter()
                    .map(|a| sh_single_quote(a))
                    .collect::<Vec<_>>()
                    .join(" ");
                let wrapped = format!("echo $$ > {} && exec {}", sh_single_quote(pf), inner);
                cmd.arg("sh").arg("-c").arg(&wrapped);
            }
            None => {
                for arg in command {
                    cmd.arg(arg);
                }
            }
        }

        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn {} exec: {}", self.cli_program, e))?;

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();

        Ok(RuntimeCliProcess {
            child,
            stdin,
            stdout,
            cli_program: self.cli_program.clone(),
            container_id: container_id.to_string(),
            pid_file: pid_file.map(|s| s.to_string()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn runtime_cli_spawner_implements_trait() {
        let spawner = RuntimeCliSpawner::new("docker");
        fn assert_spawner<S: ProcessSpawner>(_s: &S) {}
        assert_spawner(&spawner);
    }
}
