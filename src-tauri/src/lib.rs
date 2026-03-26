mod commands;
mod daemon_launcher;
mod tray;

use emergent_protocol::{DaemonClient, Notification};
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

/// Wraps the daemon client with connection state.
pub struct DaemonConnection {
    pub client: Mutex<Option<Arc<DaemonClient>>>,
    pub status: Mutex<String>,
    pub launch_error: Mutex<Option<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Initialize with "starting" state
            let connection = Arc::new(DaemonConnection {
                client: Mutex::new(None),
                status: Mutex::new("starting".into()),
                launch_error: Mutex::new(None),
            });

            app.manage(connection.clone());

            // Set up system tray icon
            tray::setup_tray(app).expect("failed to build system tray");

            // Launch daemon and connect in background
            let conn = connection.clone();
            tauri::async_runtime::spawn(async move {
                launch_and_connect(app_handle, conn).await;
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
            commands::get_daemon_launch_status,
            commands::list_agents,
            commands::get_history,
            commands::get_agent_config,
            commands::set_agent_config,
            commands::connect_agents,
            commands::disconnect_agents,
            commands::set_agent_permissions,
            commands::get_agent_connections,
            commands::retry_daemon_launch,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = &event {
            api.prevent_exit();
        }
    });
}

pub async fn launch_and_connect(app_handle: tauri::AppHandle, conn: Arc<DaemonConnection>) {
    // Step 1: Ensure daemon is running
    if let Err(e) = daemon_launcher::ensure_daemon_running().await {
        log::error!("Failed to launch daemon: {}", e);
        *conn.status.lock().await = "launch_error".into();
        *conn.launch_error.lock().await = Some(e.to_string());
        return;
    }

    // Step 2: Connect to daemon
    let socket_path = emergent_protocol::socket_path();
    match DaemonClient::connect(&socket_path).await {
        Ok((client, notification_rx)) => {
            let client = Arc::new(client);
            *conn.client.lock().await = Some(client);
            *conn.status.lock().await = "connected".into();

            // Bridge notifications to Tauri events
            bridge_notifications(app_handle, notification_rx);
        }
        Err(e) => {
            log::error!("Failed to connect to daemon: {}", e);
            *conn.status.lock().await = "launch_error".into();
            *conn.launch_error.lock().await = Some(e);
        }
    }
}

fn bridge_notifications(
    handle: tauri::AppHandle,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<Notification>,
) {
    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;
        while let Some(notification) = rx.recv().await {
            let event_name = notification.event_name();
            match &notification {
                Notification::MessageChunk(p) => { let _ = handle.emit(event_name, p); }
                Notification::ToolCallUpdate(p) => { let _ = handle.emit(event_name, p); }
                Notification::PromptComplete(p) => { let _ = handle.emit(event_name, p); }
                Notification::StatusChange(p) => { let _ = handle.emit(event_name, p); }
                Notification::ConfigUpdate(p) => { let _ = handle.emit(event_name, p); }
                Notification::UserMessage(p) => { let _ = handle.emit(event_name, p); }
                Notification::Error(p) => { let _ = handle.emit(event_name, p); }
                Notification::NudgeDelivered(p) => { let _ = handle.emit(event_name, p); }
                Notification::SwarmMessage(p) => { let _ = handle.emit(event_name, p); }
                Notification::TopologyChanged(p) => { let _ = handle.emit(event_name, p); }
            }
        }
    });
}
