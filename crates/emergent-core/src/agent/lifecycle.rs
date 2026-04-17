use std::collections::HashMap;
use std::sync::Arc;

use acp::Agent as _;
use agent_client_protocol as acp;
use emergent_protocol::{
    AgentStatus, ConfigOption, ConfigUpdatePayload, Notification, SessionReadyPayload,
    StatusChangePayload, WorkspaceId,
};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex, RwLock};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use super::acp_bridge::{agent_command_loop, EmergentClient};
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

fn initial_config_from_load_response(
    load_resp: acp::LoadSessionResponse,
    config_state: &[ConfigOption],
) -> Vec<ConfigOption> {
    load_resp
        .config_options
        .as_deref()
        .map(crate::config::convert_config_options)
        .unwrap_or_else(|| config_state.to_vec())
}

/// Perform the full agent initialization: spawn process, ACP handshake,
/// store handle, and emit notifications.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn initialize_agent(
    agent_id: String,
    agent_definition_id: String,
    workspace_id: WorkspaceId,
    container_id: String,
    agent_binary: String,
    role: Option<String>,
    task_id: Option<String>,
    session_init: SessionInit,
    agents: Arc<RwLock<HashMap<String, Arc<Mutex<ThreadHandle>>>>>,
    event_tx: broadcast::Sender<Notification>,
    history: Arc<RwLock<HashMap<String, Vec<Notification>>>>,
    mcp_port: u16,
    bearer_token: String,
    cli_program: String,
    mcp_host_alias: String,
) -> Result<(), String> {
    // Spawn the agent process via ProcessSpawner
    let spawner = super::spawner::RuntimeCliSpawner::new(cli_program);
    let parts: Vec<&str> = agent_binary.split_whitespace().collect();
    let agent_workdir = format!("/home/.agents/{}/", agent_definition_id);
    let mut process = super::spawner::ProcessSpawner::spawn(
        &spawner,
        &container_id,
        &parts,
        Some(&agent_workdir),
    )
    .await
    .map_err(|e| format!("Failed to spawn agent '{}': {}", agent_binary, e))?;

    let child_stdin = process
        .take_stdin()
        .ok_or("Failed to capture agent stdin")?;
    let child_stdout = process
        .take_stdout()
        .ok_or("Failed to capture agent stdout")?;

    let is_resume = matches!(session_init, SessionInit::Load { .. });
    let (command_tx, command_rx) = mpsc::unbounded_channel::<AgentCommand>();

    let agent_id_for_thread = agent_id.clone();
    let agent_workdir_for_thread = agent_workdir.clone();
    let event_tx_clone = event_tx.clone();

    // Use a oneshot to receive the session_id + initial config (or error) from the LocalSet thread.
    let (init_tx, init_rx) =
        oneshot::channel::<Result<(acp::SessionId, Vec<ConfigOption>), String>>();

    // Spawn a dedicated thread running a LocalSet for the !Send ACP connection.
    let thread_handle = std::thread::Builder::new()
        .name(format!("acp-agent-{}", &agent_id))
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("Failed to build tokio runtime for agent thread");

            let agent_id = agent_id_for_thread;
            let local = tokio::task::LocalSet::new();
            local.block_on(&rt, async move {
                let outgoing = child_stdin.compat_write();
                let incoming = child_stdout.compat();

                let aid = agent_id.clone();
                let config_state =
                    std::sync::Arc::new(std::sync::Mutex::new(Vec::<ConfigOption>::new()));
                let client = EmergentClient::new(
                    agent_id.clone(),
                    event_tx_clone.clone(),
                    config_state.clone(),
                );

                let (conn, handle_io) =
                    acp::ClientSideConnection::new(client, outgoing, incoming, |fut| {
                        tokio::task::spawn_local(fut);
                    });

                // Spawn I/O handler
                tokio::task::spawn_local(async move {
                    if let Err(e) = handle_io.await {
                        log::error!("ACP I/O error for agent {}: {}", aid, e);
                    }
                });

                // Initialize + create/load session
                log::debug!("Agent {} starting ACP handshake", &agent_id);
                let init_result = async {
                    conn.initialize(
                        acp::InitializeRequest::new(acp::ProtocolVersion::V1).client_info(
                            acp::Implementation::new("emergent", "0.1.0").title("Emergent"),
                        ),
                    )
                    .await
                    .map_err(|e| format!("ACP initialize failed: {}", e))?;

                    // Build MCP server config for swarm communication (HTTP)
                    let mcp_config = acp::McpServer::Http(
                        acp::McpServerHttp::new(
                            "emergent-swarm",
                            format!("http://{}:{}/mcp", mcp_host_alias, mcp_port),
                        )
                        .headers(vec![acp::HttpHeader::new(
                            "Authorization",
                            format!("Bearer {}", bearer_token),
                        )]),
                    );

                    match session_init {
                        SessionInit::New => {
                            let session_resp = conn
                                .new_session(
                                    acp::NewSessionRequest::new(&agent_workdir_for_thread)
                                        .mcp_servers(vec![mcp_config]),
                                )
                                .await
                                .map_err(|e| format!("ACP new_session failed: {}", e))?;

                            let initial_config = session_resp
                                .config_options
                                .as_deref()
                                .map(crate::config::convert_config_options)
                                .unwrap_or_default();

                            *config_state.lock().unwrap() = initial_config.clone();

                            Ok::<_, String>((session_resp.session_id, initial_config))
                        }
                        SessionInit::Load { acp_session_id } => {
                            log::info!(
                                "Agent {} loading existing session {}",
                                &agent_id,
                                &acp_session_id,
                            );
                            let session_id = acp::SessionId::new(acp_session_id);

                            let load_resp = conn
                                .load_session(
                                    acp::LoadSessionRequest::new(
                                        session_id.clone(),
                                        &agent_workdir_for_thread,
                                    )
                                    .mcp_servers(vec![mcp_config]),
                                )
                                .await
                                .map_err(|e| format!("ACP load_session failed: {}", e))?;

                            let config_snapshot = config_state.lock().unwrap().clone();
                            let initial_config =
                                initial_config_from_load_response(load_resp, &config_snapshot);
                            *config_state.lock().unwrap() = initial_config.clone();

                            Ok::<_, String>((session_id, initial_config))
                        }
                    }
                }
                .await;

                let session_id = match init_result {
                    Ok((sid, config)) => {
                        log::debug!("Agent {} ACP session established: {:?}", &agent_id, sid);
                        let _ = init_tx.send(Ok((sid.clone(), config)));
                        let _ =
                            event_tx_clone.send(Notification::SessionReady(SessionReadyPayload {
                                thread_id: agent_id.clone(),
                                acp_session_id: sid.0.to_string(),
                            }));
                        sid
                    }
                    Err(e) => {
                        log::error!("Agent {} ACP handshake failed: {}", &agent_id, e);
                        let _ = init_tx.send(Err(e));
                        return;
                    }
                };

                // Command loop: receive commands from the main thread
                agent_command_loop(conn, session_id, command_rx, agent_id, event_tx_clone).await;
            });
        })
        .map_err(|e| format!("Failed to spawn agent thread: {}", e))?;

    // Wait for initialization to complete
    let (session_id, initial_config) = init_rx
        .await
        .map_err(|_| "Agent thread terminated during initialization".to_string())??;

    // Store the handle
    let prompt_notify = Arc::new(tokio::sync::Notify::new());
    let handle = ThreadHandle {
        agent_id: agent_definition_id,
        acp_session_id: Some(session_id.0.to_string()),
        status: AgentStatus::Idle,
        workspace_id,
        command_tx,
        process,
        thread_handle: Some(thread_handle),
        config_options: initial_config.clone(),
        has_management_permissions: false,
        has_prompted: is_resume,
        role,
        task_id,
        completing: false,
        last_prompted_permissions: false,
        prompt_notify,
        pending_prompt: None,
        prompt_loop_handle: None,
    };

    let _ = event_tx.send(Notification::StatusChange(StatusChangePayload {
        thread_id: agent_id.clone(),
        status: AgentStatus::Idle.to_string(),
    }));

    // Emit initial config if the agent advertised any
    if !initial_config.is_empty() {
        let _ = event_tx.send(Notification::ConfigUpdate(ConfigUpdatePayload {
            thread_id: agent_id.clone(),
            config_options: initial_config,
            changes: vec![],
        }));
    }

    let handle_arc = Arc::new(Mutex::new(handle));

    agents
        .write()
        .await
        .insert(agent_id.clone(), handle_arc.clone());

    // Initialize history for this thread
    history.write().await.entry(agent_id.clone()).or_default();

    // Spawn the prompt loop for this thread.
    let loop_handle = tokio::spawn(prompt_loop(agent_id, handle_arc.clone(), event_tx.clone()));

    // Store the loop handle so kill_thread can abort it.
    handle_arc.lock().await.prompt_loop_handle = Some(loop_handle);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_option(current_value: &str) -> acp::SessionConfigOption {
        acp::SessionConfigOption::select(
            "model",
            "Model",
            current_value.to_string(),
            vec![
                acp::SessionConfigSelectOption::new("opus-4", "Opus 4"),
                acp::SessionConfigSelectOption::new("sonnet-4", "Sonnet 4"),
            ],
        )
        .category(acp::SessionConfigOptionCategory::Model)
    }

    #[test]
    fn load_response_config_takes_priority_on_resume() {
        let load_resp =
            acp::LoadSessionResponse::new().config_options(vec![sample_option("opus-4")]);
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

        let initial = initial_config_from_load_response(acp::LoadSessionResponse::new(), &fallback);

        assert_eq!(initial.len(), fallback.len());
        assert_eq!(initial[0].id, fallback[0].id);
        assert_eq!(initial[0].current_value, fallback[0].current_value);
    }
}
