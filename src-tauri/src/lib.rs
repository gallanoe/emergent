mod commands;

use emergent_protocol::{DaemonClient, Notification};
use tauri::Manager;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Wraps the daemon client with connection state.
pub struct DaemonConnection {
    pub client: Option<Arc<DaemonClient>>,
    pub status: Mutex<String>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let socket_path = emergent_protocol::socket_path();

            // Connect synchronously to ensure state is available for commands
            let connection = tauri::async_runtime::block_on(async {
                match DaemonClient::connect(&socket_path).await {
                    Ok((client, notification_rx)) => {
                        let client = Arc::new(client);

                        // Bridge notifications to Tauri events in background
                        let handle = app_handle.clone();
                        let mut rx = notification_rx;
                        tauri::async_runtime::spawn(async move {
                            use tauri::Emitter;
                            while let Some(notification) = rx.recv().await {
                                let event_name = notification.event_name();
                                match &notification {
                                    Notification::MessageChunk(p) => {
                                        let _ = handle.emit(event_name, p);
                                    }
                                    Notification::ToolCallUpdate(p) => {
                                        let _ = handle.emit(event_name, p);
                                    }
                                    Notification::PromptComplete(p) => {
                                        let _ = handle.emit(event_name, p);
                                    }
                                    Notification::StatusChange(p) => {
                                        let _ = handle.emit(event_name, p);
                                    }
                                    Notification::ConfigUpdate(p) => {
                                        let _ = handle.emit(event_name, p);
                                    }
                                    Notification::UserMessage(p) => {
                                        let _ = handle.emit(event_name, p);
                                    }
                                    Notification::Error(p) => {
                                        let _ = handle.emit(event_name, p);
                                    }
                                    Notification::NudgeDelivered(p) => {
                                        let _ = handle.emit(event_name, p);
                                    }
                                    Notification::SwarmMessage(p) => {
                                        let _ = handle.emit(event_name, p);
                                    }
                                }
                            }
                        });

                        DaemonConnection {
                            client: Some(client),
                            status: Mutex::new("connected".into()),
                        }
                    }
                    Err(e) => {
                        log::error!("Failed to connect to daemon: {}", e);
                        DaemonConnection {
                            client: None,
                            status: Mutex::new("disconnected".into()),
                        }
                    }
                }
            });

            app.manage(Arc::new(connection));
            Ok(())
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
