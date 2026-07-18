mod commands;
mod tray;

use emergent_core::agent::AgentManager;
use emergent_core::mcp::TokenRegistry;
use emergent_core::task::TaskManager;
use emergent_core::workspace::WorkspaceManager;
use emergent_protocol::Notification;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::broadcast;

/// Delivers terminal PTY output straight to the frontend, bypassing the shared
/// notification broadcast channel so a flooding terminal can never evict
/// unrelated agent notifications. `emit` is non-blocking and lossless (it does
/// not drop events the way the broadcast does for lagging receivers), and never
/// panics, satisfying the `TerminalEventSink` reader-thread contract.
///
/// Trade-off: `emit` is fire-and-forget with no webview-drain signal, so a
/// sustained command whose output outpaces the webview's render rate grows the
/// webview event queue without bound (the old shared broadcast was bounded but
/// evicted unrelated notifications instead). True end-to-end backpressure isn't
/// achievable here; bounding terminal output via a consumer-paced/coalescing
/// channel is a tracked hardening follow-up. In practice the user interrupts
/// such a command long before it matters.
struct TauriTerminalSink {
    handle: tauri::AppHandle,
}

impl emergent_core::workspace::terminal::TerminalEventSink for TauriTerminalSink {
    fn output(&self, session_id: &str, data: &[u8]) {
        use tauri::Emitter;
        let _ = self.handle.emit(
            "terminal:output",
            emergent_protocol::TerminalOutputPayload {
                session_id: session_id.to_string(),
                data: data.to_vec(),
            },
        );
    }

    fn exited(&self, session_id: &str) {
        use tauri::Emitter;
        let _ = self.handle.emit(
            "terminal:exited",
            emergent_protocol::TerminalExitedPayload {
                session_id: session_id.to_string(),
            },
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .setup(|app| {
            let _rt_guard = tauri::async_runtime::handle().inner().enter();

            let (event_tx, _) = broadcast::channel::<Notification>(1024);

            let workspace_state = emergent_core::workspace::new_shared_state();

            // Terminal output is delivered through this sink (straight to the
            // webview) rather than the shared broadcast, so a high-output shell
            // command can't flood the channel and evict agent notifications.
            let terminal_sink: Arc<dyn emergent_core::workspace::terminal::TerminalEventSink> =
                Arc::new(TauriTerminalSink {
                    handle: app.handle().clone(),
                });

            let workspace_manager = tauri::async_runtime::block_on(async {
                let wm = WorkspaceManager::new(workspace_state.clone(), terminal_sink).await;
                if let Err(e) = wm.load_workspaces().await {
                    log::error!("Failed to load workspaces: {}", e);
                }
                Arc::new(wm)
            });

            let token_registry = Arc::new(TokenRegistry::new());

            let manager = Arc::new(AgentManager::new(
                workspace_state.clone(),
                event_tx.clone(),
                token_registry.clone(),
            ));

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

            tauri::async_runtime::block_on(async {
                // Build the set of "recoverable" thread IDs — threads that either
                // are currently live or have a persisted mapping that the frontend
                // can later resume. Tasks whose session_id is not in this set
                // cannot possibly make progress and should be marked Failed.
                let mut recoverable_thread_ids: std::collections::HashSet<String> =
                    manager.live_thread_ids().await;

                // Every workspace is ready under the local-process model — all
                // are candidates for eager task resume after recovery.
                let mut all_workspaces: Vec<emergent_protocol::WorkspaceId> = Vec::new();

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
                        for m in &mappings {
                            recoverable_thread_ids.insert(m.thread_id.clone());
                        }
                        // Hydrate the dormant map so subsequent persists keep
                        // these mappings in threads.json and list_threads
                        // surfaces them. Must run before recover_stale_tasks.
                        manager
                            .thread_manager()
                            .hydrate_dormant_for_workspace(ws_id, mappings)
                            .await;
                    }

                    manager
                        .thread_manager()
                        .seed_usage_from_dir(ws_id, workspace_path)
                        .await;

                    all_workspaces.push(ws_id.clone());
                }
                drop(state);

                task_manager
                    .recover_stale_tasks(&recoverable_thread_ids)
                    .await;

                for ws_id in all_workspaces {
                    task_manager.resume_workspace_tasks(&ws_id).await;
                }
            });

            app.manage(manager.clone());
            app.manage(task_manager.clone());
            app.manage(workspace_manager);

            tray::setup_tray(app).expect("failed to build system tray");

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
                                // Terminal output/exit are delivered directly to
                                // the webview via TerminalEventSink and never flow
                                // through this broadcast. These arms are no-ops to
                                // keep the match exhaustive without re-introducing
                                // a second (double-)emit path for terminal events.
                                Notification::TerminalOutput(_)
                                | Notification::TerminalExited(_) => {}
                                Notification::AgentCreated(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::AgentDeleted(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::SessionReady(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::TokenUsage(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::TurnUsage(p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::TaskCreated(ref p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::TaskUpdated(ref p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::TaskStatusNotification(ref p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::QueueChanged(ref p) => {
                                    let _ = bridge_handle.emit(event_name, p);
                                }
                                Notification::TurnDispatched(p) => {
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
            commands::list_queue,
            commands::edit_queued,
            commands::remove_queued,
            commands::reorder_queue,
            commands::clear_queue,
            commands::kill_thread,
            commands::shutdown_thread,
            commands::get_history,
            commands::get_thread_config,
            commands::set_thread_config,
            commands::set_thread_permissions,
            commands::create_workspace,
            commands::delete_workspace,
            commands::list_workspaces,
            commands::get_workspace,
            commands::update_workspace,
            commands::create_terminal_session,
            commands::write_terminal,
            commands::resize_terminal,
            commands::close_terminal_session,
            commands::get_workspace_usage,
            commands::create_task,
            commands::list_tasks,
            commands::get_task,
            commands::list_tasks_for_agent,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Two-flag shutdown gate. `cleanup_started` prevents spawning the cleanup
    // task twice; `exit_approved` lets our own `handle.exit(0)` pass through
    // the second `ExitRequested` (and the `Exit` handler skip when the
    // async path already ran cleanup).
    let cleanup_started = Arc::new(AtomicBool::new(false));
    let exit_approved = Arc::new(AtomicBool::new(false));

    app.run(move |app_handle, event| match &event {
        tauri::RunEvent::ExitRequested { api, .. } => {
            if exit_approved.load(Ordering::SeqCst) {
                return;
            }
            api.prevent_exit();
            if cleanup_started.swap(true, Ordering::SeqCst) {
                return;
            }

            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.hide();
            }

            // Watchdog on an OS thread (survives tokio runtime teardown) in
            // case Tauri's exit itself hangs after cleanup completes.
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_secs(10));
                eprintln!("emergent: shutdown watchdog triggered — forcing exit");
                std::process::exit(1);
            });

            app_handle
                .state::<Arc<WorkspaceManager>>()
                .inner()
                .close_all_terminal_sessions();

            let manager = app_handle.state::<Arc<AgentManager>>().inner().clone();
            let handle = app_handle.clone();
            let exit_approved = exit_approved.clone();
            tauri::async_runtime::spawn(async move {
                shutdown_all_threads(manager, std::time::Duration::from_secs(5)).await;
                exit_approved.store(true, Ordering::SeqCst);
                handle.exit(0);
            });
        }
        // macOS cmd-Q / menu-bar Quit skips ExitRequested and jumps straight
        // to Exit (Tauri bug tauri-apps/tauri#9198). Run cleanup synchronously
        // here, within the ~5s macOS grants during applicationWillTerminate.
        tauri::RunEvent::Exit => {
            if exit_approved.load(Ordering::SeqCst) {
                return;
            }
            app_handle
                .state::<Arc<WorkspaceManager>>()
                .inner()
                .close_all_terminal_sessions();

            let manager = app_handle.state::<Arc<AgentManager>>().inner().clone();
            tauri::async_runtime::block_on(shutdown_all_threads(
                manager,
                std::time::Duration::from_secs(3),
            ));
        }
        _ => {}
    });
}

async fn shutdown_all_threads(manager: Arc<AgentManager>, cap: std::time::Duration) {
    let started = std::time::Instant::now();
    let ids = manager.live_thread_ids().await;
    log::info!("shutdown: {} live thread(s)", ids.len());

    let mut set = tokio::task::JoinSet::new();
    for id in ids {
        let m = manager.clone();
        set.spawn(async move {
            let t = std::time::Instant::now();
            match m.shutdown_thread(&id).await {
                Ok(()) => log::info!("shutdown: thread {} done in {:?}", id, t.elapsed()),
                Err(e) => log::warn!("shutdown: thread {} error after {:?}: {}", id, t.elapsed(), e),
            }
        });
    }

    let wait = async {
        while set.join_next().await.is_some() {}
    };
    if tokio::time::timeout(cap, wait).await.is_err() {
        log::warn!(
            "shutdown: cleanup exceeded {:?}, aborting {} remaining task(s)",
            cap,
            set.len()
        );
        set.abort_all();
    }
    log::info!("shutdown: finished in {:?}", started.elapsed());
}
