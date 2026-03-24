use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::sync::{mpsc, Mutex, oneshot};

use crate::transport::{self, WriteHalf};
use crate::types::*;

pub struct DaemonClient {
    writer: Arc<Mutex<BufWriter<WriteHalf>>>,
    next_id: Arc<Mutex<u64>>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>>,
}

impl DaemonClient {
    /// Connect to the daemon socket. Returns the client and a notification receiver.
    pub async fn connect(
        socket_path: &std::path::Path,
    ) -> Result<(Self, mpsc::UnboundedReceiver<Notification>), String> {
        let stream = transport::connect(socket_path)
            .await
            .map_err(|e| format!("Failed to connect to daemon: {}", e))?;

        let (reader, writer) = stream.into_split();
        let reader = BufReader::new(reader);
        let writer = Arc::new(Mutex::new(BufWriter::new(writer)));
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let (notification_tx, notification_rx) = mpsc::unbounded_channel();

        let pending_for_reader = pending.clone();

        // Spawn reader task
        tokio::spawn(async move {
            let mut reader = reader;
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break,
                    Ok(_) => {
                        // Try as response first (has "id" field)
                        if let Ok(resp) = serde_json::from_str::<JsonRpcResponse>(&line) {
                            let mut pending = pending_for_reader.lock().await;
                            if let Some(tx) = pending.remove(&resp.id) {
                                let _ = tx.send(resp);
                            }
                        } else if let Ok(notif) =
                            serde_json::from_str::<JsonRpcNotification>(&line)
                        {
                            if let Ok(n) = serde_json::from_value::<Notification>(notif.params) {
                                let _ = notification_tx.send(n);
                            }
                        }
                    }
                    Err(e) => {
                        log::error!("DaemonClient reader error: {}", e);
                        break;
                    }
                }
            }
        });

        Ok((
            Self {
                writer,
                next_id: Arc::new(Mutex::new(1)),
                pending,
            },
            notification_rx,
        ))
    }

    async fn call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let id = {
            let mut next = self.next_id.lock().await;
            let id = *next;
            *next += 1;
            id
        };

        let req = JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id,
            method: method.into(),
            params: Some(params),
        };

        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        let line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        let mut w = self.writer.lock().await;
        w.write_all(line.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        w.write_all(b"\n").await.map_err(|e| e.to_string())?;
        w.flush().await.map_err(|e| e.to_string())?;
        drop(w);

        let resp = rx.await.map_err(|_| "Connection closed".to_string())?;

        if let Some(err) = resp.error {
            Err(err.message)
        } else {
            Ok(resp.result.unwrap_or(serde_json::Value::Null))
        }
    }

    // ── Typed convenience methods ────────────────────────────────

    pub async fn spawn_agent(
        &self,
        working_directory: String,
        agent_cli: String,
    ) -> Result<String, String> {
        let result = self
            .call(
                "spawn_agent",
                serde_json::json!({
                    "working_directory": working_directory,
                    "agent_cli": agent_cli,
                }),
            )
            .await?;
        result["agent_id"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "Invalid response".into())
    }

    pub async fn send_prompt(&self, agent_id: &str, text: String) -> Result<(), String> {
        self.call(
            "send_prompt",
            serde_json::json!({
                "agent_id": agent_id,
                "text": text,
            }),
        )
        .await?;
        Ok(())
    }

    pub async fn cancel_prompt(&self, agent_id: &str) -> Result<(), String> {
        self.call(
            "cancel_prompt",
            serde_json::json!({
                "agent_id": agent_id,
            }),
        )
        .await?;
        Ok(())
    }

    pub async fn kill_agent(&self, agent_id: &str) -> Result<(), String> {
        self.call(
            "kill_agent",
            serde_json::json!({
                "agent_id": agent_id,
            }),
        )
        .await?;
        Ok(())
    }

    pub async fn list_agents(&self) -> Result<Vec<AgentSummary>, String> {
        let result = self.call("list_agents", serde_json::json!({})).await?;
        serde_json::from_value(result["agents"].clone())
            .map_err(|e| format!("Invalid response: {}", e))
    }

    pub async fn get_history(&self, agent_id: &str) -> Result<Vec<Notification>, String> {
        let result = self
            .call(
                "get_history",
                serde_json::json!({
                    "agent_id": agent_id,
                }),
            )
            .await?;
        serde_json::from_value(result["notifications"].clone())
            .map_err(|e| format!("Invalid response: {}", e))
    }

    pub async fn detect_agents(&self) -> Result<Vec<AgentInfo>, String> {
        let result = self.call("detect_agents", serde_json::json!({})).await?;
        serde_json::from_value(result["agents"].clone())
            .map_err(|e| format!("Invalid response: {}", e))
    }

    pub async fn known_agents(&self) -> Result<Vec<KnownAgent>, String> {
        let result = self.call("known_agents", serde_json::json!({})).await?;
        serde_json::from_value(result["agents"].clone())
            .map_err(|e| format!("Invalid response: {}", e))
    }

    pub async fn get_agent_config(
        &self,
        agent_id: &str,
    ) -> Result<Vec<ConfigOption>, String> {
        let result = self
            .call(
                "get_agent_config",
                serde_json::json!({ "agent_id": agent_id }),
            )
            .await?;
        serde_json::from_value(result["config_options"].clone())
            .map_err(|e| format!("Invalid response: {}", e))
    }

    pub async fn set_agent_config(
        &self,
        agent_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<Vec<ConfigOption>, String> {
        let result = self
            .call(
                "set_agent_config",
                serde_json::json!({
                    "agent_id": agent_id,
                    "config_id": config_id,
                    "value": value,
                }),
            )
            .await?;
        serde_json::from_value(result["config_options"].clone())
            .map_err(|e| format!("Invalid response: {}", e))
    }

    // ── Swarm management methods ─────────────────────────────────

    pub async fn connect_agents(&self, agent_id_a: &str, agent_id_b: &str) -> Result<(), String> {
        self.call(
            "connect_agents",
            serde_json::json!({
                "agent_id_a": agent_id_a,
                "agent_id_b": agent_id_b,
            }),
        )
        .await?;
        Ok(())
    }

    pub async fn disconnect_agents(
        &self,
        agent_id_a: &str,
        agent_id_b: &str,
    ) -> Result<(), String> {
        self.call(
            "disconnect_agents",
            serde_json::json!({
                "agent_id_a": agent_id_a,
                "agent_id_b": agent_id_b,
            }),
        )
        .await?;
        Ok(())
    }

    pub async fn get_agent_connections(&self, agent_id: &str) -> Result<Vec<String>, String> {
        let result = self
            .call(
                "get_agent_connections",
                serde_json::json!({ "agent_id": agent_id }),
            )
            .await?;
        serde_json::from_value(result["connections"].clone())
            .map_err(|e| format!("Invalid response: {}", e))
    }

    pub async fn set_agent_permissions(
        &self,
        agent_id: &str,
        enabled: bool,
    ) -> Result<(), String> {
        self.call(
            "set_agent_permissions",
            serde_json::json!({
                "agent_id": agent_id,
                "enabled": enabled,
            }),
        )
        .await?;
        Ok(())
    }

    pub async fn send_swarm_message(
        &self,
        from_agent_id: &str,
        to_agent_id: &str,
        body: &str,
    ) -> Result<(), String> {
        self.call(
            "send_swarm_message",
            serde_json::json!({
                "from_agent_id": from_agent_id,
                "to_agent_id": to_agent_id,
                "body": body,
            }),
        )
        .await?;
        Ok(())
    }

    pub async fn read_mailbox(&self, agent_id: &str) -> Result<serde_json::Value, String> {
        self.call(
            "read_mailbox",
            serde_json::json!({ "agent_id": agent_id }),
        )
        .await
    }
}
