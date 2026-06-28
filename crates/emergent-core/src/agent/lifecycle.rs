use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use agent_client_protocol as acp;
use agent_client_protocol::schema::{
    HttpHeader, Implementation, LoadSessionRequest, LoadSessionResponse, McpServer, McpServerHttp,
    NewSessionRequest, ProtocolVersion, SessionId,
};
use emergent_protocol::{
    AgentStatus, ConfigOption, ConfigUpdatePayload, Notification, SessionReadyPayload,
    StatusChangePayload, WorkspaceId,
};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex, RwLock};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use super::acp_bridge::{
    agent_command_loop, build_permission_response, handle_session_update,
};
use super::prompt_loop::prompt_loop;
use super::spawner::AgentProcess;
use super::{AgentCommand, ThreadHandle};

/// Whether to create a new session or load an existing one.
pub(crate) enum SessionInit {
    /// Create a brand new ACP session.
    New,
    /// Resume an existing session by loading it with the stored session ID.
    Load { acp_session_id: String },
}

/// Outcome of a completed `await_handshake` future.
pub(crate) enum InitOutcome {
    /// The handshake completed and the thread graduated to `Idle`.
    Ready,
    /// A concurrent stop/kill claimed the thread during the handshake window;
    /// the canceller already tore down the process and cleaned up. The caller
    /// must NOT emit an error or revoke the token — that's the canceller's job.
    Cancelled,
}

/// State handed from `initialize_agent` (which has already published the
/// `Initializing` handle into the live map) to `await_handshake` (which runs in
/// the background, waits for the ACP handshake, and graduates the handle).
///
/// Splitting these two phases lets the caller register the handle *synchronously*
/// before returning the thread id, so there is no window in which a kill/stop
/// targeting the freshly-returned id can no-op against an unregistered thread.
pub(crate) struct PendingHandshake {
    agent_id: String,
    agent_binary: String,
    handle_arc: Arc<Mutex<ThreadHandle>>,
    init_rx: oneshot::Receiver<Result<(SessionId, Vec<ConfigOption>), String>>,
    agents: Arc<RwLock<HashMap<String, Arc<Mutex<ThreadHandle>>>>>,
    event_tx: broadcast::Sender<Notification>,
}

/// Split an agent command string into argv with shell-style quoting, so a binary
/// or argument containing spaces (e.g. a CLI under a path with spaces) survives
/// intact instead of being shattered by naive whitespace splitting.
fn parse_agent_command(agent_binary: &str) -> Result<Vec<String>, String> {
    let parts = shell_words::split(agent_binary)
        .map_err(|e| format!("Failed to parse agent command '{}': {}", agent_binary, e))?;
    if parts.is_empty() {
        return Err(format!("Agent command '{}' is empty", agent_binary));
    }
    Ok(parts)
}

fn initial_config_from_load_response(
    load_resp: LoadSessionResponse,
    config_state: &[ConfigOption],
) -> Vec<ConfigOption> {
    load_resp
        .config_options
        .as_deref()
        .map(crate::config::convert_config_options)
        .unwrap_or_else(|| config_state.to_vec())
}

/// Phase 1 of agent startup: spawn the process, start the ACP connection thread,
/// and publish an `Initializing` handle into the live map. This is fast (it does
/// NOT wait for the handshake) and is awaited synchronously by the caller so the
/// thread is cancellable the instant its id is known. The returned
/// `PendingHandshake` must be passed to `await_handshake` (typically on a
/// background task) to complete startup.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn initialize_agent(
    agent_id: String,
    agent_definition_id: String,
    workspace_id: WorkspaceId,
    agent_binary: String,
    task_id: Option<String>,
    session_init: SessionInit,
    agents: Arc<RwLock<HashMap<String, Arc<Mutex<ThreadHandle>>>>>,
    event_tx: broadcast::Sender<Notification>,
    history: Arc<RwLock<HashMap<String, Vec<Notification>>>>,
    mcp_port: u16,
    bearer_token: String,
    agent_home: std::path::PathBuf,
) -> Result<PendingHandshake, String> {
    let spawner = super::spawner::LocalProcessSpawner::new();
    let parts = parse_agent_command(&agent_binary)?;
    let parts: Vec<&str> = parts.iter().map(String::as_str).collect();

    // The agent runs with both its cwd and $HOME set to its own directory so
    // that per-agent config (.claude/.codex/…) stays isolated from other
    // agents and from the user's real home. The ACP session cwd is the same dir.
    let agent_workdir = agent_home.to_string_lossy().into_owned();
    let bun_cache = crate::workspace::paths::emergent_root()
        .join("cache")
        .join("bun");
    let _ = tokio::fs::create_dir_all(&bun_cache).await;
    let env: Vec<(String, String)> = vec![
        ("HOME".to_string(), agent_workdir.clone()),
        // Pass the enriched PATH explicitly rather than mutating the global env:
        // the child no longer inherits an in-place-modified parent PATH, so it
        // still finds CLIs in login-shell dirs the GUI launch context misses.
        ("PATH".to_string(), crate::detect::enriched_path().to_string()),
        (
            "BUN_INSTALL_CACHE_DIR".to_string(),
            bun_cache.to_string_lossy().into_owned(),
        ),
    ];

    let mut process = super::spawner::ProcessSpawner::spawn(&spawner, &parts, &agent_home, &env)
        .await
        .map_err(|e| format!("Failed to spawn agent '{}': {}", agent_binary, e))?;

    let child_stdin = process
        .take_stdin()
        .ok_or("Failed to capture agent stdin")?;
    let child_stdout = process
        .take_stdout()
        .ok_or("Failed to capture agent stdout")?;

    let is_resume = matches!(session_init, SessionInit::Load { .. });
    // Capture the session id up front for the resume case so the early-registered
    // handle stays resumable even if it's stopped mid-handshake (stop demotes it
    // back to a dormant stub keyed by this id).
    let initial_acp_session_id = match &session_init {
        SessionInit::New => None,
        SessionInit::Load { acp_session_id } => Some(acp_session_id.clone()),
    };
    let (command_tx, command_rx) = mpsc::unbounded_channel::<AgentCommand>();

    let agent_id_for_thread = agent_id.clone();
    let event_tx_clone = event_tx.clone();
    let workspace_id_str = workspace_id.0.clone();
    let agent_definition_id_for_loop = agent_definition_id.clone();

    // Use a oneshot to receive the session_id + initial config (or error) from the ACP task.
    let (init_tx, init_rx) =
        oneshot::channel::<Result<(SessionId, Vec<ConfigOption>), String>>();

    // The config state is shared between the notification handler and the command loop.
    let config_state = Arc::new(std::sync::Mutex::new(Vec::<ConfigOption>::new()));
    let config_for_notif = config_state.clone();
    let config_for_init = config_state.clone();

    // Echo flag: set to true by the command loop before each manager-initiated
    // prompt; consumed (set to false) by the notification handler on the first
    // UserMessageChunk it sees for that turn.
    let expect_echo = Arc::new(AtomicBool::new(false));
    let expect_echo_for_notif = expect_echo.clone();
    let expect_echo_for_loop = expect_echo.clone();

    // Build the byte-stream transport for the ACP connection.
    let outgoing = child_stdin.compat_write();
    let incoming = child_stdout.compat();
    let transport = acp::ByteStreams::new(outgoing, incoming);

    // Spawn a dedicated OS thread with its own tokio runtime for the ACP connection.
    // The 0.11.1 SDK requires Send futures, so LocalSet is no longer needed.
    let thread_handle = std::thread::Builder::new()
        .name(format!("acp-agent-{}", &agent_id))
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("Failed to build tokio runtime for agent thread");

            let agent_id = agent_id_for_thread;

            rt.block_on(async move {
                let connect_result = acp::Client
                    .builder()
                    .on_receive_notification(
                        {
                            let agent_id = agent_id.clone();
                            let event_tx = event_tx_clone.clone();
                            async move |notification: acp::schema::SessionNotification,
                                        _cx: acp::ConnectionTo<acp::Agent>| {
                                log::trace!(
                                    "Agent {} received ACP session update: {:?}",
                                    &agent_id,
                                    std::mem::discriminant(&notification.update)
                                );
                                handle_session_update(
                                    &agent_id,
                                    notification.update,
                                    &event_tx,
                                    &config_for_notif,
                                    &expect_echo_for_notif,
                                );
                                Ok(())
                            }
                        },
                        acp::on_receive_notification!(),
                    )
                    .on_receive_request(
                        async move |args: acp::schema::RequestPermissionRequest,
                                    responder: acp::Responder<
                            acp::schema::RequestPermissionResponse,
                        >,
                                    _connection: acp::ConnectionTo<acp::Agent>| {
                            let response = build_permission_response(&args);
                            let _ = responder.respond(response);
                            Ok(())
                        },
                        acp::on_receive_request!(),
                    )
                    .connect_with(transport, {
                        let agent_id = agent_id.clone();
                        let event_tx_clone = event_tx_clone.clone();
                        async move |conn: acp::ConnectionTo<acp::Agent>| {
                            log::debug!("Agent {} starting ACP handshake", &agent_id);

                            // Initialize
                            conn.send_request(
                                acp::schema::InitializeRequest::new(ProtocolVersion::V1)
                                    .client_info(
                                        Implementation::new("emergent", "0.1.0")
                                            .title("Emergent"),
                                    ),
                            )
                            .block_task()
                            .await
                            .map_err(|e| {
                                acp::schema::Error::internal_error()
                                    .data(format!("ACP initialize failed: {}", e))
                            })?;

                            // Build MCP server config for swarm communication (HTTP)
                            let mcp_config = McpServer::Http(
                                McpServerHttp::new(
                                    "emergent-swarm",
                                    format!("http://127.0.0.1:{}/mcp", mcp_port),
                                )
                                .headers(vec![HttpHeader::new(
                                    "Authorization",
                                    format!("Bearer {}", bearer_token),
                                )]),
                            );

                            let init_result: Result<(SessionId, Vec<ConfigOption>), String> =
                                async {
                                    match session_init {
                                        SessionInit::New => {
                                            let session_resp = conn
                                                .send_request(
                                                    NewSessionRequest::new(&agent_workdir)
                                                        .mcp_servers(vec![mcp_config]),
                                                )
                                                .block_task()
                                                .await
                                                .map_err(|e| {
                                                    format!("ACP new_session failed: {}", e)
                                                })?;

                                            let initial_config = session_resp
                                                .config_options
                                                .as_deref()
                                                .map(crate::config::convert_config_options)
                                                .unwrap_or_default();

                                            *config_for_init.lock().unwrap() =
                                                initial_config.clone();

                                            Ok((session_resp.session_id, initial_config))
                                        }
                                        SessionInit::Load { acp_session_id } => {
                                            log::info!(
                                                "Agent {} loading existing session {}",
                                                &agent_id,
                                                &acp_session_id,
                                            );
                                            let session_id = SessionId::new(acp_session_id);

                                            let load_resp = conn
                                                .send_request(
                                                    LoadSessionRequest::new(
                                                        session_id.clone(),
                                                        &agent_workdir,
                                                    )
                                                    .mcp_servers(vec![mcp_config]),
                                                )
                                                .block_task()
                                                .await
                                                .map_err(|e| {
                                                    format!("ACP load_session failed: {}", e)
                                                })?;

                                            let config_snapshot =
                                                config_for_init.lock().unwrap().clone();
                                            let initial_config =
                                                initial_config_from_load_response(
                                                    load_resp,
                                                    &config_snapshot,
                                                );
                                            *config_for_init.lock().unwrap() =
                                                initial_config.clone();

                                            Ok((session_id, initial_config))
                                        }
                                    }
                                }
                                .await;

                            let session_id = match init_result {
                                Ok((sid, config)) => {
                                    log::debug!(
                                        "Agent {} ACP session established: {:?}",
                                        &agent_id,
                                        sid
                                    );
                                    // The main side emits SessionReady once it has
                                    // graduated the registered handle, so a thread
                                    // cancelled mid-handshake produces nothing stray.
                                    let _ = init_tx.send(Ok((sid.clone(), config)));
                                    sid
                                }
                                Err(e) => {
                                    log::error!(
                                        "Agent {} ACP handshake failed: {}",
                                        &agent_id,
                                        e
                                    );
                                    let _ = init_tx.send(Err(e));
                                    return Ok(());
                                }
                            };

                            // Command loop: receive commands from the main thread.
                            // workspace_id and agent_definition_id are forwarded so the
                            // loop can emit TurnUsage with full attribution context.
                            agent_command_loop(
                                conn,
                                session_id,
                                command_rx,
                                agent_id,
                                event_tx_clone,
                                workspace_id_str,
                                agent_definition_id_for_loop,
                                expect_echo_for_loop,
                            )
                            .await;

                            Ok(())
                        }
                    })
                    .await;

                if let Err(e) = connect_result {
                    log::error!("ACP connection error for agent {}: {}", agent_id, e);
                }
            });
        })
        .map_err(|e| format!("Failed to spawn agent thread: {}", e))?;

    // Register the handle in the live map with status `Initializing` BEFORE the
    // handshake completes. This makes the thread cancellable during the (up to
    // 60s) ACP init window: stop/kill/delete and the bulk workspace/agent kills
    // all operate on the live map, so they can now tear down a stuck-initializing
    // agent (process, OS thread, and bearer token) instead of no-op'ing until the
    // timeout fires. The handle is graduated to `Idle` in place once the
    // handshake succeeds (see below).
    let handle = ThreadHandle {
        agent_id: agent_definition_id,
        acp_session_id: initial_acp_session_id,
        status: AgentStatus::Initializing,
        workspace_id,
        command_tx,
        process,
        thread_handle: Some(thread_handle),
        config_options: Vec::new(),
        has_management_permissions: false,
        has_prompted: is_resume,
        task_id,
        completing: false,
        last_prompted_permissions: false,
        prompt_notify: Arc::new(tokio::sync::Notify::new()),
        pending_prompt: None,
        prompt_loop_handle: None,
    };
    let handle_arc = Arc::new(Mutex::new(handle));

    // Initialize history and publish the handle before awaiting the handshake.
    history.write().await.entry(agent_id.clone()).or_default();
    agents
        .write()
        .await
        .insert(agent_id.clone(), handle_arc.clone());
    let _ = event_tx.send(Notification::StatusChange(StatusChangePayload {
        thread_id: agent_id.clone(),
        status: AgentStatus::Initializing.to_string(),
    }));

    Ok(PendingHandshake {
        agent_id,
        agent_binary,
        handle_arc,
        init_rx,
        agents,
        event_tx,
    })
}

/// Phase 2 of agent startup: wait for the ACP handshake (bounded by a timeout)
/// and graduate the already-registered handle to `Idle`, or tear it down on
/// failure. Returns `Cancelled` if a concurrent stop/kill claimed the thread
/// during the handshake window (the canceller owns teardown + token revocation).
pub(crate) async fn await_handshake(
    pending: PendingHandshake,
) -> Result<InitOutcome, String> {
    let PendingHandshake {
        agent_id,
        agent_binary,
        handle_arc,
        init_rx,
        agents,
        event_tx,
    } = pending;

    // Wait for ACP initialization, bounded by a timeout so a binary that starts
    // but never speaks valid ACP can't hang "initializing" forever (which would
    // leak the process, its dedicated OS thread, and the bearer token).
    let init_timeout = std::time::Duration::from_secs(60);
    let init_outcome = match tokio::time::timeout(init_timeout, init_rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Agent thread terminated during initialization".to_string()),
        Err(_) => Err(format!(
            "Agent '{}' did not complete ACP initialization within {}s",
            agent_binary,
            init_timeout.as_secs()
        )),
    };

    let (session_id, initial_config) = match init_outcome {
        Ok(v) => v,
        Err(e) => {
            // Remove our entry and tear down the process — unless a concurrent
            // stop/kill already claimed this thread (it owns the teardown).
            let owned = {
                let mut map = agents.write().await;
                match map.get(&agent_id) {
                    Some(h) if Arc::ptr_eq(h, &handle_arc) => {
                        map.remove(&agent_id);
                        true
                    }
                    _ => false,
                }
            };
            if owned {
                // Kill the process group + reap; the ACP OS thread exits once its
                // transport breaks. The caller revokes the token and emits Error.
                let mut h = handle_arc.lock().await;
                let _ = h.process.shutdown(std::time::Duration::from_secs(2)).await;
                h.thread_handle.take();
                return Err(e);
            }
            return Ok(InitOutcome::Cancelled);
        }
    };

    // Graduate the handle to `Idle` in place, atomically w.r.t. a concurrent
    // stop/kill (which removes the entry under this same map write lock). If the
    // entry is gone, we were cancelled mid-handshake: the canceller already tore
    // down the process, so leave everything to it.
    {
        let map = agents.write().await;
        if !matches!(map.get(&agent_id), Some(h) if Arc::ptr_eq(h, &handle_arc)) {
            return Ok(InitOutcome::Cancelled);
        }
        {
            let mut h = handle_arc.lock().await;
            h.acp_session_id = Some(session_id.0.to_string());
            h.config_options = initial_config.clone();
            h.status = AgentStatus::Idle;
            // Spawn the prompt loop while the map lock is held so a racing kill
            // can never observe a graduated handle whose prompt_loop_handle is
            // still None (which would leak an un-abortable task).
            h.prompt_loop_handle = Some(tokio::spawn(prompt_loop(
                agent_id.clone(),
                handle_arc.clone(),
                event_tx.clone(),
            )));
        }

        // Emit graduation notifications while holding the map lock so a racing
        // kill cannot slip a `Dead` in ahead of these.
        let _ = event_tx.send(Notification::SessionReady(SessionReadyPayload {
            thread_id: agent_id.clone(),
            acp_session_id: session_id.0.to_string(),
        }));
        let _ = event_tx.send(Notification::StatusChange(StatusChangePayload {
            thread_id: agent_id.clone(),
            status: AgentStatus::Idle.to_string(),
        }));
        if !initial_config.is_empty() {
            let _ = event_tx.send(Notification::ConfigUpdate(ConfigUpdatePayload {
                thread_id: agent_id.clone(),
                config_options: initial_config,
                changes: vec![],
            }));
        }
    }

    Ok(InitOutcome::Ready)
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::{
        SessionConfigOption, SessionConfigOptionCategory, SessionConfigSelectOption,
    };

    fn sample_option(current_value: &str) -> SessionConfigOption {
        SessionConfigOption::select(
            "model",
            "Model",
            current_value.to_string(),
            vec![
                SessionConfigSelectOption::new("opus-4", "Opus 4"),
                SessionConfigSelectOption::new("sonnet-4", "Sonnet 4"),
            ],
        )
        .category(SessionConfigOptionCategory::Model)
    }

    #[test]
    fn parse_agent_command_splits_plain_args() {
        assert_eq!(
            parse_agent_command("bunx @zed-industries/claude-agent-acp").unwrap(),
            vec!["bunx", "@zed-industries/claude-agent-acp"]
        );
    }

    #[test]
    fn parse_agent_command_preserves_quoted_paths_with_spaces() {
        // A binary path containing a space must stay a single argv entry.
        assert_eq!(
            parse_agent_command("\"/opt/my tools/agent\" acp --flag").unwrap(),
            vec!["/opt/my tools/agent", "acp", "--flag"]
        );
        assert_eq!(
            parse_agent_command("agent --msg 'hello world'").unwrap(),
            vec!["agent", "--msg", "hello world"]
        );
    }

    #[test]
    fn parse_agent_command_rejects_empty_and_unbalanced() {
        assert!(parse_agent_command("   ").is_err());
        assert!(parse_agent_command("").is_err());
        // Unterminated quote is a parse error, not a silent mis-split.
        assert!(parse_agent_command("agent \"unterminated").is_err());
    }

    #[test]
    fn load_response_config_takes_priority_on_resume() {
        let load_resp =
            LoadSessionResponse::new().config_options(vec![sample_option("opus-4")]);
        let fallback = vec![ConfigOption {
            id: "model".into(),
            name: "Model".into(),
            description: None,
            category: Some("model".into()),
            current_value: "sonnet-4".into(),
            options: emergent_protocol::ConfigSelectOptions::Ungrouped(vec![
                emergent_protocol::ConfigSelectOption {
                    value: "opus-4".into(),
                    name: "Opus 4".into(),
                },
                emergent_protocol::ConfigSelectOption {
                    value: "sonnet-4".into(),
                    name: "Sonnet 4".into(),
                },
            ]),
        }];

        let initial = initial_config_from_load_response(load_resp, &fallback);

        assert_eq!(initial.len(), 1);
        assert_eq!(initial[0].id, "model");
        assert_eq!(initial[0].current_value, "opus-4");
    }

    #[test]
    fn load_response_falls_back_to_notification_cache_when_missing_config() {
        let fallback = vec![ConfigOption {
            id: "model".into(),
            name: "Model".into(),
            description: None,
            category: Some("model".into()),
            current_value: "sonnet-4".into(),
            options: emergent_protocol::ConfigSelectOptions::Ungrouped(vec![
                emergent_protocol::ConfigSelectOption {
                    value: "opus-4".into(),
                    name: "Opus 4".into(),
                },
                emergent_protocol::ConfigSelectOption {
                    value: "sonnet-4".into(),
                    name: "Sonnet 4".into(),
                },
            ]),
        }];

        let initial = initial_config_from_load_response(LoadSessionResponse::new(), &fallback);

        assert_eq!(initial.len(), fallback.len());
        assert_eq!(initial[0].id, fallback[0].id);
        assert_eq!(initial[0].current_value, fallback[0].current_value);
    }
}
