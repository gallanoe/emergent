use std::collections::HashMap;
use std::pin::Pin;
use std::sync::Arc;

use bollard::exec::{CreateExecOptions, ResizeExecOptions, StartExecOptions, StartExecResults};
use bollard::Docker;
use emergent_protocol::{Notification, TerminalExitedPayload, TerminalOutputPayload, WorkspaceId};
use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;
use tokio::sync::{broadcast, Mutex};
use tokio::task::JoinHandle;

pub type TerminalSessions = Arc<Mutex<HashMap<String, TerminalSession>>>;

pub fn new_terminal_sessions() -> TerminalSessions {
    Arc::new(Mutex::new(HashMap::new()))
}

fn generate_session_id() -> String {
    let mut buf = [0u8; 8];
    getrandom::fill(&mut buf).expect("Failed to generate random bytes");
    hex::encode(buf)
}

pub struct TerminalSession {
    pub session_id: String,
    pub workspace_id: WorkspaceId,
    pub exec_id: String,
    stdin: Pin<Box<dyn tokio::io::AsyncWrite + Send>>,
    output_task: JoinHandle<()>,
}

impl TerminalSession {
    pub async fn write(&mut self, data: &[u8]) -> Result<(), String> {
        self.stdin
            .as_mut()
            .write_all(data)
            .await
            .map_err(|e| format!("Failed to write to terminal: {}", e))
    }

    pub async fn resize(
        docker: &Docker,
        exec_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        docker
            .resize_exec(
                exec_id,
                ResizeExecOptions {
                    width: cols,
                    height: rows,
                },
            )
            .await
            .map_err(|e| format!("Failed to resize terminal: {}", e))
    }

    pub fn close(self) {
        self.output_task.abort();
        // stdin is dropped, which closes the exec's stdin
    }
}

/// Detect which shell is available in the container.
async fn detect_shell(docker: &Docker, container_id: &str) -> String {
    let check = docker
        .create_exec(
            container_id,
            CreateExecOptions::<&str> {
                cmd: Some(vec!["test", "-x", "/bin/bash"]),
                attach_stdout: Some(false),
                attach_stderr: Some(false),
                ..Default::default()
            },
        )
        .await;

    if let Ok(exec) = check {
        if let Ok(StartExecResults::Detached) = docker
            .start_exec(
                &exec.id,
                Some(StartExecOptions {
                    detach: true,
                    ..Default::default()
                }),
            )
            .await
        {
            if let Ok(inspect) = docker.inspect_exec(&exec.id).await {
                if inspect.exit_code == Some(0) {
                    return "/bin/bash".to_string();
                }
            }
        }
    }

    "/bin/sh".to_string()
}

pub async fn create_session(
    docker: &Docker,
    container_id: &str,
    workspace_id: WorkspaceId,
    event_tx: &broadcast::Sender<Notification>,
) -> Result<TerminalSession, String> {
    let shell = detect_shell(docker, container_id).await;

    let exec = docker
        .create_exec(
            container_id,
            CreateExecOptions::<&str> {
                cmd: Some(vec![&shell]),
                attach_stdin: Some(true),
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                tty: Some(true),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| format!("Failed to create exec: {}", e))?;

    let exec_id = exec.id.clone();

    let result = docker
        .start_exec(
            &exec.id,
            Some(StartExecOptions {
                detach: false,
                ..Default::default()
            }),
        )
        .await
        .map_err(|e| format!("Failed to start exec: {}", e))?;

    let (stdin, mut output) = match result {
        StartExecResults::Attached { input, output } => (input, output),
        StartExecResults::Detached => {
            return Err("Exec started in detached mode unexpectedly".to_string());
        }
    };

    let session_id = generate_session_id();

    // Spawn output reader task
    let tx = event_tx.clone();
    let sid = session_id.clone();
    let output_task = tokio::spawn(async move {
        while let Some(chunk) = output.next().await {
            match chunk {
                Ok(log_output) => {
                    let bytes = log_output.into_bytes();
                    if bytes.is_empty() {
                        continue;
                    }
                    let _ = tx.send(Notification::TerminalOutput(TerminalOutputPayload {
                        session_id: sid.clone(),
                        data: bytes.to_vec(),
                    }));
                }
                Err(e) => {
                    log::warn!("Terminal output stream error: {}", e);
                    break;
                }
            }
        }
        // Stream ended — shell exited
        let _ = tx.send(Notification::TerminalExited(TerminalExitedPayload {
            session_id: sid,
        }));
    });

    Ok(TerminalSession {
        session_id,
        workspace_id,
        exec_id,
        stdin,
        output_task,
    })
}

/// Close all terminal sessions for a workspace.
pub async fn close_sessions_for_workspace(sessions: &TerminalSessions, workspace_id: &WorkspaceId) {
    let mut map = sessions.lock().await;
    let ids_to_remove: Vec<String> = map
        .iter()
        .filter(|(_, s)| s.workspace_id == *workspace_id)
        .map(|(id, _)| id.clone())
        .collect();

    for id in ids_to_remove {
        if let Some(session) = map.remove(&id) {
            session.close();
        }
    }
}
