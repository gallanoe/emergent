mod agent_manager;
mod commands;
mod detect;

use std::sync::Arc;
use agent_manager::AgentManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(AgentManager::new()))
        .invoke_handler(tauri::generate_handler![
            commands::detect_agents,
            commands::spawn_agent,
            commands::send_prompt,
            commands::cancel_prompt,
            commands::kill_agent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
