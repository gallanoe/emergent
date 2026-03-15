mod agent;
mod commands;
mod error;
mod events;
mod vcs;
mod workspace;
mod state;

use commands::workspace::AppState;
use events::EventEmitter;
use std::sync::{Arc, RwLock};
use tauri::{Emitter, Manager};

struct TauriEmitter {
    app_handle: tauri::AppHandle,
}

impl EventEmitter for TauriEmitter {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        let _ = self.app_handle.emit(event, payload);
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let base_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir")
                .join("workspaces");
            std::fs::create_dir_all(&base_dir).expect("failed to create workspaces dir");

            let emitter: Arc<dyn EventEmitter> = Arc::new(TauriEmitter {
                app_handle: app.handle().clone(),
            });
            let app_state = AppState {
                workspace: RwLock::new(workspace::WorkspaceService::new(
                    base_dir,
                    emitter.clone(),
                )),
                vcs: RwLock::new(vcs::VcsService::new(emitter)),
            };
            app.manage(app_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::workspace::create_workspace,
            commands::workspace::open_workspace,
            commands::workspace::list_workspaces,
            commands::workspace::delete_workspace,
            commands::workspace::create_document,
            commands::workspace::read_document,
            commands::workspace::write_document,
            commands::workspace::delete_document,
            commands::workspace::move_document,
            commands::workspace::create_folder,
            commands::workspace::delete_folder,
            commands::workspace::move_folder,
            commands::workspace::list_tree,
            commands::vcs::vcs_commit,
            commands::vcs::vcs_get_log,
            commands::vcs::vcs_get_status,
            commands::vcs::vcs_create_branch,
            commands::vcs::vcs_list_branches,
            commands::vcs::vcs_delete_branch,
            commands::vcs::vcs_merge_branch,
            commands::vcs::vcs_stage,
            commands::vcs::vcs_unstage,
            commands::vcs::vcs_diff,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
