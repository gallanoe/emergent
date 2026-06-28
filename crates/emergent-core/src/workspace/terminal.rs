use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use emergent_protocol::WorkspaceId;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

#[cfg(unix)]
use libc::{SIGKILL, SIGTERM};
#[cfg(not(unix))]
const SIGTERM: i32 = 15;
#[cfg(not(unix))]
const SIGKILL: i32 = 9;

/// Sink for terminal output/exit events, implemented by the Tauri layer.
///
/// The PTY reader thread delivers output straight through this sink to the
/// frontend instead of fanning it out over the shared notification broadcast
/// channel. That keeps a high-output command (`yes`, `find /`) from flooding the
/// broadcast and evicting unrelated agent notifications for slow subscribers, and
/// (unlike a broadcast, which evicts oldest messages for lagging receivers)
/// terminal output is never dropped to keep up.
///
/// Implementations MUST NOT panic and MUST NOT block indefinitely: they are
/// called synchronously from the reader thread, so a panic would abandon child
/// reaping and session cleanup, and an indefinite block would wedge the reader.
/// Deliver best-effort and swallow transport errors.
pub trait TerminalEventSink: Send + Sync {
    /// A chunk of raw output bytes read from the PTY.
    fn output(&self, session_id: &str, data: &[u8]);
    /// The shell exited and the session was removed.
    fn exited(&self, session_id: &str);
}

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

/// Guarantees the shell is reaped and its session entry removed when the reader
/// thread ends — including on an unwind, so a panic (e.g. a misbehaving sink)
/// can't leak a zombie child or a stale map entry. It deliberately does NOT
/// touch the sink: a sink that violated its no-panic contract must not be able
/// to trigger a second panic from a Drop run during the first one's unwind.
struct ReaderCleanup {
    child: Box<dyn portable_pty::Child + Send + Sync>,
    sessions: TerminalSessions,
    session_id: String,
}

impl Drop for ReaderCleanup {
    fn drop(&mut self) {
        let _ = self.child.wait();
        if let Ok(mut map) = self.sessions.lock() {
            map.remove(&self.session_id);
        }
    }
}

/// Open a host PTY, spawn the shell, register the session in `sessions`, and
/// start the reader thread. Returns the new session id.
pub async fn create_session(
    sessions: &TerminalSessions,
    cwd: std::path::PathBuf,
    workspace_id: WorkspaceId,
    sink: Arc<dyn TerminalEventSink>,
) -> Result<String, String> {
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
    // Output is delivered synchronously through `sink` (not the shared broadcast)
    // so a flooding command can neither evict agent notifications nor drop bytes.
    let sid = session_id.clone();
    let sessions_for_reader = sessions.clone();
    let reader_spawn = std::thread::Builder::new()
        .name(format!("term-{}", session_id))
        .spawn(move || {
            // Declared first so it drops LAST: on normal exit it runs after
            // `sink.exited` below; on an unwind it still reaps the child and
            // removes the session. Underscore-prefixed (not bare `_`) so it
            // lives until scope end rather than dropping immediately.
            let _cleanup = ReaderCleanup {
                child,
                sessions: sessions_for_reader,
                session_id: sid.clone(),
            };

            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => sink.output(&sid, &buf[..n]),
                    Err(_) => break,
                }
            }
            // Notify the frontend the shell exited; `cleanup` then reaps the
            // shell and removes the session as it drops at scope end.
            sink.exited(&sid);
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Records everything the reader thread delivers, so a test can assert that
    /// output and the exit signal flow through the sink (not the broadcast).
    #[derive(Default)]
    struct RecordingSink {
        output: Mutex<Vec<u8>>,
        exited: Mutex<Vec<String>>,
    }

    impl TerminalEventSink for RecordingSink {
        fn output(&self, _session_id: &str, data: &[u8]) {
            self.output.lock().unwrap().extend_from_slice(data);
        }
        fn exited(&self, session_id: &str) {
            self.exited.lock().unwrap().push(session_id.to_string());
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn output_and_exit_flow_through_the_sink() {
        let sink = Arc::new(RecordingSink::default());
        let sessions = new_terminal_sessions();

        let session_id = create_session(
            &sessions,
            std::env::temp_dir(),
            WorkspaceId::from("test-ws"),
            sink.clone(),
        )
        .await
        .expect("create terminal session");

        // Drive the shell to print a marker and exit.
        {
            let writer = sessions
                .lock()
                .unwrap()
                .get(&session_id)
                .expect("session present")
                .writer_handle();
            let mut w = writer.lock().unwrap();
            w.write_all(b"printf 'EMERGENT_OK\\n'; exit\n").unwrap();
            w.flush().unwrap();
        }

        // Wait (bounded) for the reader thread to report the shell's exit.
        let mut waited_ms = 0u64;
        while sink.exited.lock().unwrap().is_empty() {
            assert!(waited_ms <= 5000, "terminal did not exit within 5s");
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            waited_ms += 25;
        }

        let out = String::from_utf8_lossy(&sink.output.lock().unwrap()).into_owned();
        assert!(
            out.contains("EMERGENT_OK"),
            "expected marker in terminal output, got: {:?}",
            out
        );
        assert_eq!(
            sink.exited.lock().unwrap().as_slice(),
            std::slice::from_ref(&session_id)
        );
        // The reader removes the session from the map once the shell exits.
        assert!(!sessions.lock().unwrap().contains_key(&session_id));
    }
}
