mod commands;
mod tray;

use emergent_core::agent::AgentManager;
use emergent_core::mcp::TokenRegistry;
use emergent_protocol::Notification;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let _rt_guard = tauri::async_runtime::handle().inner().enter();

            // Create shared token registry
            let token_registry = Arc::new(TokenRegistry::new());

            // Create the agent manager
            let manager = Arc::new(AgentManager::new(token_registry.clone()));
            app.manage(manager.clone());

            // Set up system tray icon
            tray::setup_tray(app).expect("failed to build system tray");

            // Bridge agent notifications to Tauri events
            let bridge_handle = app.handle().clone();
            let mut bridge_rx = manager.subscribe();
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
                        http_manager.set_mcp_port(server.port);
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
            commands::detect_agents,
            commands::known_agents,
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
