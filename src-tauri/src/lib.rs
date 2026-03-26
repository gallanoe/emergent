mod commands;
mod tray;

use emergent_daemon::agent_manager::AgentManager;
use emergent_protocol::Notification;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Notify;

pub struct ShutdownSignal(pub Arc<Notify>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Create the agent manager (replaces the separate daemon process)
            let manager = Arc::new(AgentManager::new());
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

            // Start socket server for MCP sidecars and remote clients
            let server_manager = manager.clone();
            let shutdown = Arc::new(Notify::new());
            app.manage(ShutdownSignal(shutdown.clone()));
            tauri::async_runtime::spawn(async move {
                let socket_path = emergent_protocol::socket_path();

                // Clean up stale socket if present
                if std::path::Path::new(&socket_path).exists() {
                    let _ = std::fs::remove_file(&socket_path);
                }

                match emergent_protocol::TransportListener::bind(&socket_path) {
                    Ok(listener) => {
                        log::info!("Socket server listening on {}", socket_path.display());
                        emergent_daemon::run_server(listener, server_manager, shutdown).await;
                    }
                    Err(e) => {
                        log::error!("Failed to bind socket server: {}", e);
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

    app.run(|app_handle, event| {
        match &event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                api.prevent_exit();
            }
            tauri::RunEvent::Exit => {
                if let Some(signal) = app_handle.try_state::<ShutdownSignal>() {
                    signal.0.notify_one();
                }
                let socket_path = emergent_protocol::socket_path();
                let _ = std::fs::remove_file(&socket_path);
            }
            _ => {}
        }
    });
}
