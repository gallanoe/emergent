use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use emergent_protocol::{Notification, TerminalExitedPayload, TerminalOutputPayload, WorkspaceId};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tokio::sync::broadcast;

#[cfg(unix)]
use libc::{SIGKILL, SIGTERM};
#[cfg(not(unix))]
const SIGTERM: i32 = 15;
#[cfg(not(unix))]
const SIGKILL: i32 = 9;

/// Sessions are held behind a std Mutex (not a tokio one) so the blocking PTY
/// reader thread can remove its own entry on exit, and so no map lock is ever
/// held across a blocking PTY write. Every lock here is brief — never across an
/// `.await`.
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

/// Signal a whole process group (`kill -<signal> -<pgid>`). No-op off unix.
fn signal_group(pgid: i32, signal: i32) {
    #[cfg(unix)]
    // SAFETY: `killpg` is async-signal-safe; `pgid` is the shell's process group.
    unsafe {
        let _ = libc::killpg(pgid, signal);
    }
    #[cfg(not(unix))]
    {
        let _ = (pgid, signal);
    }
}

/// An interactive terminal backed by a host PTY running the user's shell.
pub struct TerminalSession {
    pub workspace_id: WorkspaceId,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Box<dyn MasterPty + Send>,
    /// Process-group leader (== the shell pid; portable-pty makes the shell a
    /// session/group leader). Signalling the group also reaps the shell's
    /// job-control children. `None` if the pid is unavailable.
    pgid: Option<i32>,
}

impl TerminalSession {
    /// A cheap clone of the writer handle, so callers can write without holding
    /// the sessions-map lock across the blocking write.
    pub fn writer_handle(&self) -> Arc<Mutex<Box<dyn Write + Send>>> {
        self.writer.clone()
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

    /// Kill the shell's whole process group. The reader thread then observes
    /// EOF, reaps the child, and removes the session from the map.
    pub fn close(self) {
        if let Some(pgid) = self.pgid {
            signal_group(pgid, SIGTERM);
            signal_group(pgid, SIGKILL);
        }
    }
}

/// Open a host PTY, spawn the shell, register the session in `sessions`, and
/// start the reader thread. Returns the new session id.
pub async fn create_session(
    sessions: &TerminalSessions,
    cwd: std::path::PathBuf,
    workspace_id: WorkspaceId,
    event_tx: &broadcast::Sender<Notification>,
) -> Result<String, String> {
    let shell = default_shell();

    // Opening the PTY and spawning the shell are blocking operations.
    let (master, writer, mut reader, mut child) = tokio::task::spawn_blocking(move || {
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

    let pgid = child.process_id().map(|p| p as i32);
    let session_id = generate_session_id();

    {
        let mut map = sessions.lock().unwrap();
        map.insert(
            session_id.clone(),
            TerminalSession {
                workspace_id,
                writer: Arc::new(Mutex::new(writer)),
                master,
                pgid,
            },
        );
    }

    // Reader thread owns the child + a master reader clone. It pumps output
    // until EOF, then reaps the shell and removes the session from the map.
    let tx = event_tx.clone();
    let sid = session_id.clone();
    let sessions_for_reader = sessions.clone();
    let reader_spawn = std::thread::Builder::new()
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
            // Reap the shell to avoid a zombie, drop the session, notify.
            let _ = child.wait();
            if let Ok(mut map) = sessions_for_reader.lock() {
                map.remove(&sid);
            }
            let _ = tx.send(Notification::TerminalExited(TerminalExitedPayload {
                session_id: sid,
            }));
        });

    if let Err(e) = reader_spawn {
        // The reader thread failed to spawn — remove the just-inserted session
        // and kill the shell so neither is leaked.
        if let Some(s) = sessions.lock().unwrap().remove(&session_id) {
            s.close();
        }
        return Err(format!("Failed to spawn terminal reader thread: {}", e));
    }

    Ok(session_id)
}

/// Close (kill the process group of) all terminal sessions for a workspace.
pub fn close_sessions_for_workspace(sessions: &TerminalSessions, workspace_id: &WorkspaceId) {
    let to_close: Vec<TerminalSession> = {
        let mut map = sessions.lock().unwrap();
        let ids: Vec<String> = map
            .iter()
            .filter(|(_, s)| s.workspace_id == *workspace_id)
            .map(|(id, _)| id.clone())
            .collect();
        ids.into_iter().filter_map(|id| map.remove(&id)).collect()
    };
    for session in to_close {
        session.close();
    }
}

/// Close every terminal session. Used on application shutdown.
pub fn close_all_sessions(sessions: &TerminalSessions) {
    let all: Vec<TerminalSession> = {
        let mut map = sessions.lock().unwrap();
        map.drain().map(|(_, s)| s).collect()
    };
    for session in all {
        session.close();
    }
}
