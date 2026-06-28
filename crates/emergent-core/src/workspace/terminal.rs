use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex as StdMutex};

use emergent_protocol::{Notification, TerminalExitedPayload, TerminalOutputPayload, WorkspaceId};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tokio::sync::{broadcast, Mutex};

pub type TerminalSessions = Arc<Mutex<HashMap<String, TerminalSession>>>;

pub fn new_terminal_sessions() -> TerminalSessions {
    Arc::new(Mutex::new(HashMap::new()))
}

fn generate_session_id() -> String {
    let mut buf = [0u8; 8];
    getrandom::fill(&mut buf).expect("Failed to generate random bytes");
    hex::encode(buf)
}

/// The user's login shell, with a sensible per-platform fallback.
fn default_shell() -> String {
    #[cfg(unix)]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
    #[cfg(not(unix))]
    {
        std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string())
    }
}

/// An interactive terminal backed by a host PTY running the user's shell.
pub struct TerminalSession {
    pub session_id: String,
    pub workspace_id: WorkspaceId,
    master: Box<dyn MasterPty + Send>,
    writer: Arc<StdMutex<Box<dyn Write + Send>>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

impl TerminalSession {
    pub async fn write(&mut self, data: &[u8]) -> Result<(), String> {
        let writer = self.writer.clone();
        let data = data.to_vec();
        tokio::task::spawn_blocking(move || {
            let mut w = writer
                .lock()
                .map_err(|_| "terminal writer poisoned".to_string())?;
            w.write_all(&data)
                .map_err(|e| format!("Failed to write to terminal: {}", e))?;
            w.flush()
                .map_err(|e| format!("Failed to flush terminal: {}", e))
        })
        .await
        .map_err(|e| format!("terminal write task failed: {}", e))?
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize terminal: {}", e))
    }

    pub fn close(mut self) {
        // Killing the shell makes the PTY master read return EOF, which ends
        // the reader thread; the writer/master are dropped with `self`.
        let _ = self.child.kill();
    }
}

pub async fn create_session(
    cwd: std::path::PathBuf,
    workspace_id: WorkspaceId,
    event_tx: &broadcast::Sender<Notification>,
) -> Result<TerminalSession, String> {
    let shell = default_shell();

    // Opening the PTY and spawning the shell are blocking operations.
    let (master, writer, mut reader, child) = tokio::task::spawn_blocking(move || {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open pty: {}", e))?;

        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(&cwd);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;
        // Drop the slave so the master sees EOF once the shell exits.
        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take terminal writer: {}", e))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone terminal reader: {}", e))?;

        Ok::<_, String>((pair.master, writer, reader, child))
    })
    .await
    .map_err(|e| format!("terminal setup task failed: {}", e))??;

    let session_id = generate_session_id();

    // Reader thread: pump PTY output into notifications until EOF.
    let tx = event_tx.clone();
    let sid = session_id.clone();
    std::thread::Builder::new()
        .name(format!("term-{}", session_id))
        .spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let _ = tx.send(Notification::TerminalOutput(TerminalOutputPayload {
                            session_id: sid.clone(),
                            data: buf[..n].to_vec(),
                        }));
                    }
                    Err(_) => break,
                }
            }
            let _ = tx.send(Notification::TerminalExited(TerminalExitedPayload {
                session_id: sid,
            }));
        })
        .map_err(|e| format!("Failed to spawn terminal reader thread: {}", e))?;

    Ok(TerminalSession {
        session_id,
        workspace_id,
        master,
        writer: Arc::new(StdMutex::new(writer)),
        child,
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
