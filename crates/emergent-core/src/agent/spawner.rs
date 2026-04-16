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
#[async_trait]
pub trait ProcessSpawner: Send + Sync {
    type Process: AgentProcess;
    async fn spawn(
        &self,
        container_id: &str,
        command: &[&str],
        workdir: Option<&str>,
    ) -> Result<Self::Process, String>;
}

// ---------------------------------------------------------------------------
// RuntimeCliSpawner — uses `<runtime> exec -i` via tokio::process::Command
// ---------------------------------------------------------------------------

pub struct RuntimeCliProcess {
    child: tokio::process::Child,
    stdin: Option<tokio::process::ChildStdin>,
    stdout: Option<tokio::process::ChildStdout>,
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
    ) -> Result<Self::Process, String> {
        let mut cmd = tokio::process::Command::new(&self.cli_program);
        cmd.arg("exec").arg("-i");
        if let Some(dir) = workdir {
            cmd.arg("-w").arg(dir);
        }
        cmd.arg(container_id);
        for arg in command {
            cmd.arg(arg);
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
