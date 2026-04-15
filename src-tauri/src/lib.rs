mod commands;
mod tray;

use emergent_core::agent::AgentManager;
use emergent_core::mcp::TokenRegistry;
use emergent_core::task::TaskManager;
use emergent_core::workspace::WorkspaceManager;
use emergent_protocol::Notification;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::broadcast;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let _rt_guard = tauri::async_runtime::handle().inner().enter();

            // Create shared notification channel
            let (event_tx, _) = broadcast::channel::<Notification>(1024);

            // Create shared workspace state
            let workspace_state = emergent_core::workspace::new_shared_state();

            // Connect to Docker (optional — log warning if unavailable)
            let docker = match bollard::Docker::connect_with_local_defaults() {
                Ok(d) => Some(d),
                Err(e) => {
                    log::warn!("Docker not available: {}", e);
                    None
                }
            };

            // Create workspace manager (async — use block_on)
            let workspace_manager = tauri::async_runtime::block_on(async {
                let wm =
                    WorkspaceManager::new(workspace_state.clone(), event_tx.clone(), docker).await;
                if let Err(e) = wm.load_workspaces().await {
                    log::error!("Failed to load workspaces: {}", e);
                }
                Arc::new(wm)
            });

            // Create shared token registry
            let token_registry = Arc::new(TokenRegistry::new());

            // Create the agent manager (new API: workspace_state, event_tx, token_registry)
            let manager = Arc::new(AgentManager::new(
                workspace_state.clone(),
                event_tx.clone(),
                token_registry.clone(),
            ));

            // Create task manager
            let task_manager = Arc::new(TaskManager::new(manager.clone(), event_tx.clone()));
            let event_rx = event_tx.subscribe();
            task_manager.start_event_loop(event_rx);

            // Start MCP HTTP server before any persisted task sessions are
            // resumed so reloaded agents receive a valid MCP endpoint instead
            // of the default port 0.
            let mcp_server = tauri::async_runtime::block_on(async {
                emergent_core::mcp::http_server::start(
                    manager.clone(),
                    token_registry.clone(),
                    task_manager.clone(),
                )
                .await
            });
            match mcp_server {
                Ok(server) => {
                    tauri::async_runtime::block_on(async {
                        manager.set_mcp_port(server.port).await;
                    });
                    log::info!("MCP HTTP server started on 127.0.0.1:{}", server.port);
                    app.manage(server);
                }
                Err(e) => {
                    log::error!("Failed to start MCP HTTP server: {}", e);
                }
            }

            // Load persisted agent definitions, thread mappings, and tasks for all workspaces
            tauri::async_runtime::block_on(async {
                // Build the set of "recoverable" thread IDs — threads that either
                // are currently live or have a persisted mapping that the frontend
                // can later resume. Tasks whose session_id is not in this set
                // cannot possibly make progress and should be marked Failed.
                let mut recoverable_thread_ids: std::collections::HashSet<String> =
                    manager.live_thread_ids().await;

                // Workspaces whose containers are running — candidates for
                // eager task resume + start-unblocked after recovery.
                let mut running_workspaces: Vec<emergent_protocol::WorkspaceId> = Vec::new();

                let state = workspace_state.read().await;
                for (ws_id, ws) in state.workspaces.iter() {
                    if let Err(e) = manager.load_agents_for_workspace(ws_id).await {
                        log::error!(
                            "Failed to load agent definitions for workspace '{}': {}",
                            ws_id,
                            e
                        );
                    }

                    let workspace_path = &ws.path;
                    task_manager.load_tasks(workspace_path).await.ok();

                    if let Ok(mappings) =
                        emergent_core::agent::thread_manager::ThreadManager::load_from_dir(
                            workspace_path,
                        )
                        .await
                    {
                        for m in mappings {
                            recoverable_thread_ids.insert(m.thread_id);
                        }
                    }

                    if matches!(
                        ws.container_status,
                        emergent_protocol::ContainerStatus::Running
                    ) {
                        running_workspaces.push(ws_id.clone());
                    }
                }
                drop(state);

                task_manager
                    .recover_stale_tasks(&recoverable_thread_ids)
                    .await;

                // For each workspace whose container is already running, resume
                // any Working task threads and start any Pending tasks with all
                // blockers Completed. Workspaces whose containers are stopped
                // are deferred until the user brings the container up via
                // start_container, which triggers the same logic.
                for ws_id in running_workspaces {
                    task_manager.resume_workspace_tasks(&ws_id).await;
                }
            });

            app.manage(manager.clone());
            app.manage(task_manager.clone());
            app.manage(workspace_manager);

            // Set up system tray icon
            tray::setup_tray(app).expect("failed to build system tray");

            // Bridge notifications to Tauri events
            let bridge_handle = app.handle().clone();
            let mut bridge_rx = event_tx.subscribe();
            tauri::async_runtime::spawn(async move {
                use tauri::Emitter;
                loop {
                    match bridge_rx.recv().await {
                        Ok(notification) => {
                            let event_name = notification.event_name();
                            match &notification {
                                Notification::MessageChunk(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::ToolCallUpdate(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::PromptComplete(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::StatusChange(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::ConfigUpdate(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::UserMessage(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::Error(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::NudgeDelivered(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::SystemMessage(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::TopologyChanged(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::WorkspaceStatusChange(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::TerminalOutput(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::TerminalExited(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::AgentCreated(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::AgentDeleted(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::SessionReady(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::TaskCreated(ref p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::TaskUpdated(ref p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            log::warn!("Notification bridge lagged, missed {} events", n);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::known_agents,
            commands::create_agent,
            commands::update_agent,
            commands::delete_agent,
            commands::get_agent,
            commands::list_agent_definitions,
            commands::list_threads,
            commands::list_thread_mappings,
            commands::spawn_thread,
            commands::resume_thread,
            commands::delete_thread,
            commands::send_prompt,
            commands::cancel_prompt,
            commands::kill_thread,
            commands::get_daemon_status,
            commands::get_history,
            commands::get_thread_config,
            commands::set_thread_config,
            commands::connect_agents,
            commands::disconnect_agents,
            commands::set_thread_permissions,
            commands::get_thread_connections,
            commands::create_workspace,
            commands::delete_workspace,
            commands::list_workspaces,
            commands::get_workspace,
            commands::update_workspace,
            commands::get_dockerfile,
            commands::open_dockerfile_editor,
            commands::start_container,
            commands::stop_container,
            commands::rebuild_container,
            commands::detect_docker,
            commands::create_terminal_session,
            commands::write_terminal,
            commands::resize_terminal,
            commands::close_terminal_session,
            commands::create_task,
            commands::list_tasks,
            commands::get_task,
            commands::list_tasks_for_agent,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        match &event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                api.prevent_exit();
            }
            tauri::RunEvent::Exit => {
                // HTTP server is cancelled when its task is dropped.
                // No socket cleanup needed.
            }
            _ => {}
        }
    });
}
