mod commands;
mod tray;

use emergent_core::agent::AgentManager;
use emergent_core::mcp::TokenRegistry;
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
                let wm = WorkspaceManager::new(
                    workspace_state.clone(),
                    event_tx.clone(),
                    docker,
                )
                .await;
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

            // Load persisted agent definitions for all loaded workspaces
            tauri::async_runtime::block_on(async {
                let state = workspace_state.read().await;
                for ws_id in state.workspaces.keys() {
                    if let Err(e) = manager.load_agents_for_workspace(ws_id).await {
                        log::error!(
                            "Failed to load agent definitions for workspace '{}': {}",
                            ws_id,
                            e
                        );
                    }
                }
            });

            app.manage(manager.clone());
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
                                Notification::MessageChunk(p) => { let _ = bridge_handle.emit(event_name, p); }
                                Notification::ToolCallUpdate(p) => { let _ = bridge_handle.emit(event_name, p); }
                                Notification::PromptComplete(p) => { let _ = bridge_handle.emit(event_name, p); }
                                Notification::StatusChange(p) => { let _ = bridge_handle.emit(event_name, p); }
                                Notification::ConfigUpdate(p) => { let _ = bridge_handle.emit(event_name, p); }
                                Notification::UserMessage(p) => { let _ = bridge_handle.emit(event_name, p); }
                                Notification::Error(p) => { let _ = bridge_handle.emit(event_name, p); }
                                Notification::NudgeDelivered(p) => { let _ = bridge_handle.emit(event_name, p); }
                                Notification::SystemMessage(p) => { let _ = bridge_handle.emit(event_name, p); }
                                Notification::SwarmMessage(p) => { let _ = bridge_handle.emit(event_name, p); }
                                Notification::TopologyChanged(p) => { let _ = bridge_handle.emit(event_name, p); }
                                Notification::WorkspaceStatusChange(p) => { let _ = bridge_handle.emit(event_name, p); }
                                Notification::TerminalOutput(p) => { let _ = bridge_handle.emit(event_name, p); }
                                Notification::TerminalExited(p) => { let _ = bridge_handle.emit(event_name, p); }
                                Notification::AgentCreated(p) => { let _ = bridge_handle.emit(event_name, p); }
                                Notification::AgentDeleted(p) => { let _ = bridge_handle.emit(event_name, p); }
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            log::warn!("Notification bridge lagged, missed {} events", n);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            });

            // Start MCP HTTP server
            let http_manager = manager.clone();
            let http_registry = token_registry.clone();
            tauri::async_runtime::spawn(async move {
                match emergent_core::mcp::http_server::start(http_manager.clone(), http_registry).await
                {
                    Ok(server) => {
                        http_manager.set_mcp_port(server.port).await;
                        log::info!(
                            "MCP HTTP server started on 127.0.0.1:{}",
                            server.port
                        );
                        // Keep cancellation token alive until app exits
                        std::future::pending::<()>().await;
                    }
                    Err(e) => {
                        log::error!("Failed to start MCP HTTP server: {}", e);
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
            commands::spawn_agent,
            commands::send_prompt,
            commands::cancel_prompt,
            commands::kill_agent,
            commands::get_daemon_status,
            commands::list_agents,
            commands::get_history,
            commands::get_agent_config,
            commands::set_agent_config,
            commands::connect_agents,
            commands::disconnect_agents,
            commands::set_agent_permissions,
            commands::get_agent_connections,
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
