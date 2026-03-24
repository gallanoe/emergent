use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::sync::broadcast;

use crate::agent_manager::AgentManager;
use crate::detect;
use emergent_protocol::*;

/// Handle a single client connection.
pub async fn handle_client(stream: TransportStream, manager: Arc<AgentManager>) {
    log::info!("New client connected");
    let (reader, writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    let writer = Arc::new(tokio::sync::Mutex::new(BufWriter::new(writer)));

    // Subscribe to notifications
    let mut event_rx = manager.subscribe();
    let writer_for_events = writer.clone();

    // Spawn notification writer task
    let notify_task = tokio::spawn(async move {
        loop {
            match event_rx.recv().await {
                Ok(notification) => {
                    log::trace!("Sending notification to client: {}", notification.event_name());
                    let json_notif = JsonRpcNotification {
                        jsonrpc: "2.0".into(),
                        method: notification.event_name().into(),
                        params: serde_json::to_value(&notification)
                            .unwrap_or(serde_json::Value::Null),
                    };
                    let mut w = writer_for_events.lock().await;
                    let line = serde_json::to_string(&json_notif).unwrap();
                    if w.write_all(line.as_bytes()).await.is_err() {
                        break;
                    }
                    if w.write_all(b"\n").await.is_err() {
                        break;
                    }
                    if w.flush().await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    log::warn!("Client lagged, missed {} notifications", n);
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Read request loop — each request is dispatched concurrently so that
    // long-running methods (e.g. send_prompt) don't block other requests
    // (e.g. cancel_prompt) from being processed.
    let mut line_buf = String::new();
    loop {
        line_buf.clear();
        match reader.read_line(&mut line_buf).await {
            Ok(0) => break, // EOF
            Ok(_) => {
                log::debug!("Received request: {}", line_buf.trim());
                let req_line = line_buf.clone();
                let mgr = manager.clone();
                let w = writer.clone();
                tokio::spawn(async move {
                    let response = dispatch_request(&req_line, &mgr).await;
                    let mut w = w.lock().await;
                    let resp_line = serde_json::to_string(&response).unwrap();
                    if w.write_all(resp_line.as_bytes()).await.is_err() {
                        return;
                    }
                    if w.write_all(b"\n").await.is_err() {
                        return;
                    }
                    let _ = w.flush().await;
                });
            }
            Err(_) => break,
        }
    }

    notify_task.abort();
}

async fn dispatch_request(line: &str, manager: &AgentManager) -> JsonRpcResponse {
    let req: JsonRpcRequest = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => return error_response(0, -32700, &format!("Parse error: {}", e)),
    };

    log::debug!("Dispatching method: {} (id: {})", req.method, req.id);
    let result = match req.method.as_str() {
        "spawn_agent" => handle_spawn_agent(&req, manager).await,
        "send_prompt" => handle_send_prompt(&req, manager).await,
        "cancel_prompt" => handle_cancel_prompt(&req, manager).await,
        "kill_agent" => handle_kill_agent(&req, manager).await,
        "list_agents" => handle_list_agents(manager).await,
        "get_history" => handle_get_history(&req, manager).await,
        "detect_agents" => handle_detect_agents(),
        "known_agents" => handle_known_agents(),
        "get_agent_config" => handle_get_agent_config(&req, manager).await,
        "set_agent_config" => handle_set_agent_config(&req, manager).await,
        "connect_agents" => handle_connect_agents(&req, manager).await,
        "disconnect_agents" => handle_disconnect_agents(&req, manager).await,
        "get_agent_connections" => handle_get_agent_connections(&req, manager).await,
        "set_agent_permissions" => handle_set_agent_permissions(&req, manager).await,
        "send_swarm_message" => handle_send_swarm_message(&req, manager).await,
        "read_mailbox" => handle_read_mailbox(&req, manager).await,
        _ => Err((-32601, format!("Method not found: {}", req.method))),
    };

    match result {
        Ok(value) => {
            log::debug!("Method {} succeeded (id: {})", req.method, req.id);
            JsonRpcResponse {
            jsonrpc: "2.0".into(),
            id: req.id,
            result: Some(value),
            error: None,
        }}
        Err((code, msg)) => {
            log::warn!("Method {} failed (id: {}): {}", req.method, req.id, msg);
            error_response(req.id, code, &msg)
        }
    }
}

fn error_response(id: u64, code: i32, message: &str) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".into(),
        id,
        result: None,
        error: Some(JsonRpcError {
            code,
            message: message.to_string(),
        }),
    }
}

// ── Method handlers ──────────────────────────────────────────

fn get_param<T: serde::de::DeserializeOwned>(
    req: &JsonRpcRequest,
    field: &str,
) -> Result<T, (i32, String)> {
    req.params
        .as_ref()
        .and_then(|p| p.get(field))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .ok_or_else(|| (-32602, format!("Missing or invalid param: {}", field)))
}

async fn handle_spawn_agent(
    req: &JsonRpcRequest,
    manager: &AgentManager,
) -> Result<serde_json::Value, (i32, String)> {
    let wd: String = get_param(req, "working_directory")?;
    let cli: String = get_param(req, "agent_cli")?;
    manager
        .spawn_agent(wd.into(), cli)
        .await
        .map(|id| serde_json::json!({ "agent_id": id }))
        .map_err(|e| (-32000, e))
}

async fn handle_send_prompt(
    req: &JsonRpcRequest,
    manager: &AgentManager,
) -> Result<serde_json::Value, (i32, String)> {
    let agent_id: String = get_param(req, "agent_id")?;
    let text: String = get_param(req, "text")?;
    manager
        .send_prompt(&agent_id, text)
        .await
        .map(|()| serde_json::json!({}))
        .map_err(|e| (-32000, e))
}

async fn handle_cancel_prompt(
    req: &JsonRpcRequest,
    manager: &AgentManager,
) -> Result<serde_json::Value, (i32, String)> {
    let agent_id: String = get_param(req, "agent_id")?;
    manager
        .cancel_prompt(&agent_id)
        .await
        .map(|()| serde_json::json!({}))
        .map_err(|e| (-32000, e))
}

async fn handle_kill_agent(
    req: &JsonRpcRequest,
    manager: &AgentManager,
) -> Result<serde_json::Value, (i32, String)> {
    let agent_id: String = get_param(req, "agent_id")?;
    manager
        .kill_agent(&agent_id)
        .await
        .map(|()| serde_json::json!({}))
        .map_err(|e| (-32000, e))
}

async fn handle_list_agents(
    manager: &AgentManager,
) -> Result<serde_json::Value, (i32, String)> {
    let agents = manager.list_agents().await;
    Ok(serde_json::json!({ "agents": agents }))
}

async fn handle_get_history(
    req: &JsonRpcRequest,
    manager: &AgentManager,
) -> Result<serde_json::Value, (i32, String)> {
    let agent_id: String = get_param(req, "agent_id")?;
    manager
        .get_history(&agent_id)
        .await
        .map(|n| serde_json::json!({ "notifications": n }))
        .map_err(|e| (-32000, e))
}

fn handle_detect_agents() -> Result<serde_json::Value, (i32, String)> {
    Ok(serde_json::json!({ "agents": detect::detect_agents() }))
}

fn handle_known_agents() -> Result<serde_json::Value, (i32, String)> {
    Ok(serde_json::json!({ "agents": detect::known_agents() }))
}

async fn handle_get_agent_config(
    req: &JsonRpcRequest,
    manager: &AgentManager,
) -> Result<serde_json::Value, (i32, String)> {
    let agent_id: String = get_param(req, "agent_id")?;
    manager
        .get_config(&agent_id)
        .await
        .map(|c| serde_json::json!({ "config_options": c }))
        .map_err(|e| (-32000, e))
}

async fn handle_set_agent_config(
    req: &JsonRpcRequest,
    manager: &AgentManager,
) -> Result<serde_json::Value, (i32, String)> {
    let agent_id: String = get_param(req, "agent_id")?;
    let config_id: String = get_param(req, "config_id")?;
    let value: String = get_param(req, "value")?;
    manager
        .set_config(&agent_id, config_id, value)
        .await
        .map(|c| serde_json::json!({ "config_options": c }))
        .map_err(|e| (-32000, e))
}

async fn handle_connect_agents(
    req: &JsonRpcRequest,
    manager: &AgentManager,
) -> Result<serde_json::Value, (i32, String)> {
    let agent_id_a: String = get_param(req, "agent_id_a")?;
    let agent_id_b: String = get_param(req, "agent_id_b")?;
    manager.connect_agents(&agent_id_a, &agent_id_b).await;
    Ok(serde_json::json!({"ok": true}))
}

async fn handle_disconnect_agents(
    req: &JsonRpcRequest,
    manager: &AgentManager,
) -> Result<serde_json::Value, (i32, String)> {
    let agent_id_a: String = get_param(req, "agent_id_a")?;
    let agent_id_b: String = get_param(req, "agent_id_b")?;
    manager.disconnect_agents(&agent_id_a, &agent_id_b).await;
    Ok(serde_json::json!({"ok": true}))
}

async fn handle_get_agent_connections(
    req: &JsonRpcRequest,
    manager: &AgentManager,
) -> Result<serde_json::Value, (i32, String)> {
    let agent_id: String = get_param(req, "agent_id")?;
    let connections = manager.get_connections(&agent_id).await;
    Ok(serde_json::json!({"connections": connections}))
}

async fn handle_set_agent_permissions(
    req: &JsonRpcRequest,
    manager: &AgentManager,
) -> Result<serde_json::Value, (i32, String)> {
    let agent_id: String = get_param(req, "agent_id")?;
    let enabled: bool = get_param(req, "enabled")?;
    manager
        .set_management_permissions(&agent_id, enabled)
        .await
        .map_err(|e| (-32000, e))?;
    Ok(serde_json::json!({"ok": true}))
}

async fn handle_send_swarm_message(
    req: &JsonRpcRequest,
    manager: &AgentManager,
) -> Result<serde_json::Value, (i32, String)> {
    let from_agent_id: String = get_param(req, "from_agent_id")?;
    let to_agent_id: String = get_param(req, "to_agent_id")?;
    let body: String = get_param(req, "body")?;
    manager
        .deliver_message(&from_agent_id, &to_agent_id, body)
        .await
        .map_err(|e| (-32000, e))?;
    Ok(serde_json::json!({"ok": true}))
}

async fn handle_read_mailbox(
    req: &JsonRpcRequest,
    manager: &AgentManager,
) -> Result<serde_json::Value, (i32, String)> {
    let agent_id: String = get_param(req, "agent_id")?;
    let messages = manager.read_mailbox(&agent_id).await;
    Ok(serde_json::json!({"messages": messages}))
}
