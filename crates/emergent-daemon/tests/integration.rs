use emergent_daemon::agent_manager::AgentManager;
use emergent_protocol::transport::{self, TransportListener};
use emergent_protocol::*;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

struct TestDaemon {
    socket_path: std::path::PathBuf,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    handle: tokio::task::JoinHandle<()>,
    _tempdir: tempfile::TempDir,
}

impl TestDaemon {
    async fn start() -> Self {
        let tempdir = tempfile::tempdir().unwrap();
        let socket_path = tempdir.path().join("test.sock");

        let manager = Arc::new(AgentManager::new());
        let listener = TransportListener::bind(&socket_path).unwrap();
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();

        let handle = tokio::spawn(async move {
            emergent_daemon::run_server(listener, manager, shutdown_rx).await;
        });

        // Small delay to let the listener start
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        Self {
            socket_path,
            shutdown_tx: Some(shutdown_tx),
            handle,
            _tempdir: tempdir,
        }
    }

    async fn connect(&self) -> TestClient {
        let stream = transport::connect(&self.socket_path).await.unwrap();
        TestClient::new(stream)
    }

    async fn shutdown(mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        let _ = self.handle.await;
    }
}

struct TestClient {
    reader: BufReader<transport::ReadHalf>,
    writer: transport::WriteHalf,
    next_id: u64,
}

impl TestClient {
    fn new(stream: TransportStream) -> Self {
        let (reader, writer) = stream.into_split();
        Self {
            reader: BufReader::new(reader),
            writer,
            next_id: 1,
        }
    }

    async fn call(&mut self, method: &str, params: serde_json::Value) -> JsonRpcResponse {
        let id = self.next_id;
        self.next_id += 1;

        let req = JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id,
            method: method.into(),
            params: Some(params),
        };

        let line = serde_json::to_string(&req).unwrap();
        self.writer.write_all(line.as_bytes()).await.unwrap();
        self.writer.write_all(b"\n").await.unwrap();
        self.writer.flush().await.unwrap();

        // Read lines until we find a response with our id
        // (skip any notifications that arrive first)
        let mut buf = String::new();
        loop {
            buf.clear();
            self.reader.read_line(&mut buf).await.unwrap();
            // Try to parse as a response (has "id" field matching ours)
            if let Ok(resp) = serde_json::from_str::<JsonRpcResponse>(&buf) {
                if resp.id == id {
                    return resp;
                }
            }
            // Otherwise it's a notification or a response to a different request — skip
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_list_agents_empty() {
    let daemon = TestDaemon::start().await;
    let mut client = daemon.connect().await;

    let resp = client.call("list_agents", serde_json::json!({})).await;
    assert!(resp.error.is_none());
    let result = resp.result.unwrap();
    let agents = result["agents"].as_array().unwrap();
    assert!(agents.is_empty());

    daemon.shutdown().await;
}

#[tokio::test]
async fn test_known_agents_returns_list() {
    let daemon = TestDaemon::start().await;
    let mut client = daemon.connect().await;

    let resp = client.call("known_agents", serde_json::json!({})).await;
    assert!(resp.error.is_none());
    let result = resp.result.unwrap();
    let agents = result["agents"].as_array().unwrap();
    // Should have at least the known agent entries (even if not installed)
    assert!(!agents.is_empty());

    daemon.shutdown().await;
}

#[tokio::test]
async fn test_detect_agents_returns_array() {
    let daemon = TestDaemon::start().await;
    let mut client = daemon.connect().await;

    let resp = client.call("detect_agents", serde_json::json!({})).await;
    assert!(resp.error.is_none());
    let result = resp.result.unwrap();
    let agents = result["agents"].as_array().unwrap();
    // May be empty if no agents installed — just check it's an array
    assert!(agents.len() <= 10);

    daemon.shutdown().await;
}

#[tokio::test]
async fn test_spawn_nonexistent_agent_fails() {
    let daemon = TestDaemon::start().await;
    let mut client = daemon.connect().await;

    let resp = client
        .call(
            "spawn_agent",
            serde_json::json!({
                "working_directory": "/tmp",
                "agent_cli": "nonexistent-agent-binary-xyz-12345"
            }),
        )
        .await;
    assert!(resp.error.is_some());

    daemon.shutdown().await;
}

#[tokio::test]
async fn test_invalid_method_returns_error() {
    let daemon = TestDaemon::start().await;
    let mut client = daemon.connect().await;

    let resp = client
        .call("nonexistent_method", serde_json::json!({}))
        .await;
    assert_eq!(resp.error.unwrap().code, -32601);

    daemon.shutdown().await;
}

#[tokio::test]
async fn test_kill_nonexistent_agent_succeeds() {
    let daemon = TestDaemon::start().await;
    let mut client = daemon.connect().await;

    let resp = client
        .call(
            "kill_agent",
            serde_json::json!({ "agent_id": "nonexistent-id" }),
        )
        .await;
    // kill_agent on non-existent ID returns Ok (no-op)
    assert!(resp.error.is_none());

    daemon.shutdown().await;
}

#[tokio::test]
async fn test_send_prompt_nonexistent_agent_fails() {
    let daemon = TestDaemon::start().await;
    let mut client = daemon.connect().await;

    let resp = client
        .call(
            "send_prompt",
            serde_json::json!({
                "agent_id": "nonexistent-id",
                "text": "hello"
            }),
        )
        .await;
    assert!(resp.error.is_some());

    daemon.shutdown().await;
}

#[tokio::test]
async fn test_missing_params_returns_error() {
    let daemon = TestDaemon::start().await;
    let mut client = daemon.connect().await;

    // spawn_agent without required params
    let resp = client.call("spawn_agent", serde_json::json!({})).await;
    assert!(resp.error.is_some());
    assert_eq!(resp.error.unwrap().code, -32602);

    daemon.shutdown().await;
}
