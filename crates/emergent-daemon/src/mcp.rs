use std::sync::Arc;

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{ServerCapabilities, ServerInfo};
use rmcp::{schemars, tool, tool_handler, tool_router, ServerHandler};
use serde::{Deserialize, Serialize};

use crate::agent_manager::AgentManager;

// ---------------------------------------------------------------------------
// Parameter types for MCP tools
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct SendMessageParams {
    #[schemars(description = "The name or ID of the connected peer agent to send the message to")]
    pub target: String,
    #[schemars(description = "The message text to send")]
    pub body: String,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct SpawnAgentParams {
    #[schemars(description = "CLI command for the agent binary (e.g. 'claude-code')")]
    pub agent_cli: String,
    #[schemars(
        description = "Working directory for the new agent. Defaults to the spawning agent's directory if not specified."
    )]
    pub working_directory: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct KillAgentParams {
    #[schemars(description = "The name or ID of the agent to kill")]
    pub target: String,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct ConnectAgentsParams {
    #[schemars(description = "First agent name or ID")]
    pub agent_a: String,
    #[schemars(description = "Second agent name or ID")]
    pub agent_b: String,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct DisconnectAgentsParams {
    #[schemars(description = "First agent name or ID")]
    pub agent_a: String,
    #[schemars(description = "Second agent name or ID")]
    pub agent_b: String,
}

// ---------------------------------------------------------------------------
// Swarm MCP Server
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct SwarmMcpServer {
    agent_id: String,
    manager: Arc<AgentManager>,
    tool_router: rmcp::handler::server::router::tool::ToolRouter<Self>,
}

impl SwarmMcpServer {
    pub fn new(agent_id: String, manager: Arc<AgentManager>) -> Self {
        Self {
            agent_id,
            manager,
            tool_router: Self::tool_router(),
        }
    }

    /// Build the `McpServerStdio` config to pass to an agent via ACP `session/new`.
    ///
    /// The daemon binary is invoked with `--mcp-stdio --agent-id=<id> --socket=<path>`
    /// to serve as an MCP stdio server for a specific agent.
    pub fn mcp_config_for_agent(
        agent_id: &str,
        socket_path: &std::path::Path,
    ) -> Result<agent_client_protocol::McpServer, String> {
        let daemon_path = std::env::current_exe()
            .map_err(|e| format!("Failed to get daemon executable path: {}", e))?;

        Ok(agent_client_protocol::McpServer::Stdio(
            agent_client_protocol::McpServerStdio::new("emergent-swarm", daemon_path).args(vec![
                "--mcp-stdio".to_string(),
                format!("--agent-id={}", agent_id),
                format!("--socket={}", socket_path.display()),
            ]),
        ))
    }

    /// Resolve a peer name/ID to an agent ID.
    /// For now, this is a direct passthrough — the caller provides agent IDs.
    /// Future: could resolve friendly names to IDs.
    fn resolve_peer(&self, _name_or_id: &str) -> String {
        _name_or_id.to_string()
    }
}

#[tool_router]
impl SwarmMcpServer {
    /// List agents you're connected to in the swarm. Returns each peer's name
    /// and current status (idle or working). Use this to discover who you can
    /// collaborate with and what they're doing.
    #[tool(
        name = "list_peers",
        description = "List agents you're connected to in the swarm. Returns each peer's name and current status (idle or working). Use this to discover who you can collaborate with and what they're doing."
    )]
    async fn list_peers(&self) -> Result<String, String> {
        let peers = self.manager.get_connections(&self.agent_id).await;
        let agents = self.manager.list_agents().await;

        let mut result = Vec::new();
        for peer_id in &peers {
            if let Some(agent) = agents.iter().find(|a| &a.id == peer_id) {
                result.push(serde_json::json!({
                    "id": agent.id,
                    "name": agent.cli,
                    "status": agent.status,
                }));
            }
        }

        serde_json::to_string_pretty(&result).map_err(|e| e.to_string())
    }

    /// Send a message to a connected peer agent. The message will be queued in
    /// their mailbox and they'll be notified on their next turn. Use this to
    /// share information, request help, or coordinate work. Returns success or
    /// an error if the target is not connected or doesn't exist.
    #[tool(
        name = "send_message",
        description = "Send a message to a connected peer agent. The message will be queued in their mailbox and they'll be notified on their next turn. Use this to share information, request help, or coordinate work."
    )]
    async fn send_message(
        &self,
        Parameters(params): Parameters<SendMessageParams>,
    ) -> Result<String, String> {
        let target_id = self.resolve_peer(&params.target);
        self.manager
            .deliver_message(&self.agent_id, &target_id, params.body.clone())
            .await?;
        Ok(serde_json::json!({
            "status": "delivered",
            "target": params.target,
            "body": params.body,
        })
        .to_string())
    }

    /// Read and clear all pending messages from your mailbox. Returns a list of
    /// messages with sender name, timestamp, and body. Messages are removed
    /// after reading — your conversation context is your archive. Call this
    /// when you receive a nudge about unread messages.
    #[tool(
        name = "read_mailbox",
        description = "Read and clear all pending messages from your mailbox. Returns messages with sender name, timestamp, and body. Messages are removed after reading. Call this when you receive a nudge about unread messages."
    )]
    async fn read_mailbox(&self) -> Result<String, String> {
        let messages = self.manager.read_mailbox(&self.agent_id).await;
        serde_json::to_string_pretty(&messages).map_err(|e| e.to_string())
    }

    /// Spawn a new agent in the swarm. Requires management permissions.
    /// The agent starts with no connections — use connect_agents to wire it in,
    /// then send_message to give it instructions.
    #[tool(
        name = "spawn_agent",
        description = "Spawn a new agent in the swarm. Requires management permissions. The agent starts with no connections — use connect_agents and then send_message to give it instructions."
    )]
    async fn spawn_agent(
        &self,
        Parameters(params): Parameters<SpawnAgentParams>,
    ) -> Result<String, String> {
        if !self.manager.has_management_permissions(&self.agent_id).await {
            return Err("Permission denied: management permissions required".to_string());
        }
        let wd = params
            .working_directory
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let agent_id = self
            .manager
            .spawn_agent(wd, params.agent_cli)
            .await
            .map_err(|e| e.to_string())?;
        Ok(serde_json::json!({"agent_id": agent_id}).to_string())
    }

    /// Kill an existing agent in the swarm. Requires management permissions.
    #[tool(
        name = "kill_agent",
        description = "Kill an existing agent in the swarm. Requires management permissions."
    )]
    async fn kill_agent(
        &self,
        Parameters(params): Parameters<KillAgentParams>,
    ) -> Result<String, String> {
        if !self.manager.has_management_permissions(&self.agent_id).await {
            return Err("Permission denied: management permissions required".to_string());
        }
        let target_id = self.resolve_peer(&params.target);
        self.manager
            .kill_agent(&target_id)
            .await
            .map_err(|e| e.to_string())?;
        Ok(r#"{"status": "killed"}"#.to_string())
    }

    /// Create a connection between two agents. Requires management permissions.
    #[tool(
        name = "connect_agents",
        description = "Create a bidirectional connection between two agents in the swarm. Requires management permissions."
    )]
    async fn connect_agents(
        &self,
        Parameters(params): Parameters<ConnectAgentsParams>,
    ) -> Result<String, String> {
        if !self.manager.has_management_permissions(&self.agent_id).await {
            return Err("Permission denied: management permissions required".to_string());
        }
        let a = self.resolve_peer(&params.agent_a);
        let b = self.resolve_peer(&params.agent_b);
        self.manager.connect_agents(&a, &b).await;
        Ok(r#"{"status": "connected"}"#.to_string())
    }

    /// Remove a connection between two agents. Requires management permissions.
    #[tool(
        name = "disconnect_agents",
        description = "Remove the connection between two agents in the swarm. Requires management permissions."
    )]
    async fn disconnect_agents(
        &self,
        Parameters(params): Parameters<DisconnectAgentsParams>,
    ) -> Result<String, String> {
        if !self.manager.has_management_permissions(&self.agent_id).await {
            return Err("Permission denied: management permissions required".to_string());
        }
        let a = self.resolve_peer(&params.agent_a);
        let b = self.resolve_peer(&params.agent_b);
        self.manager.disconnect_agents(&a, &b).await;
        Ok(r#"{"status": "disconnected"}"#.to_string())
    }
}

#[tool_handler]
impl ServerHandler for SwarmMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("Emergent swarm communication tools for inter-agent collaboration")
    }
}

// ---------------------------------------------------------------------------
// MCP Stdio mode — run when daemon is invoked with --mcp-stdio
// ---------------------------------------------------------------------------

/// Run the MCP stdio server for a specific agent.
/// This connects to the main daemon via Unix socket and routes tool calls through.
pub async fn run_mcp_stdio(agent_id: String, socket_path: std::path::PathBuf) {
    use emergent_protocol::DaemonClient;
    use rmcp::ServiceExt;

    // Connect to the main daemon
    let (client, _notification_rx) = match DaemonClient::connect(&socket_path).await {
        Ok(conn) => conn,
        Err(e) => {
            eprintln!("Failed to connect to daemon: {}", e);
            std::process::exit(1);
        }
    };

    // Create a proxy manager that forwards calls via DaemonClient
    // For the stdio MCP mode, we need a different approach since we don't
    // have direct access to the AgentManager. Instead, we create a thin
    // proxy that uses the DaemonClient to forward tool calls.
    let server = McpStdioProxy::new(agent_id, Arc::new(client));

    let (stdin, stdout) = rmcp::transport::stdio();
    match server.serve((stdin, stdout)).await {
        Ok(service) => {
            // Wait until the connection is closed
            let _ = service.waiting().await;
        }
        Err(e) => {
            eprintln!("MCP server error: {}", e);
            std::process::exit(1);
        }
    }
}

// ---------------------------------------------------------------------------
// MCP Stdio Proxy — thin wrapper over DaemonClient for stdio mode
// ---------------------------------------------------------------------------

/// A proxy MCP server that forwards tool calls to the daemon via JSON-RPC.
/// Used when the daemon binary is invoked in `--mcp-stdio` mode.
#[derive(Clone)]
struct McpStdioProxy {
    agent_id: String,
    client: Arc<emergent_protocol::DaemonClient>,
    tool_router: rmcp::handler::server::router::tool::ToolRouter<Self>,
}

impl McpStdioProxy {
    fn new(agent_id: String, client: Arc<emergent_protocol::DaemonClient>) -> Self {
        Self {
            agent_id,
            client,
            tool_router: Self::tool_router(),
        }
    }
}

// For the stdio proxy, we implement a simpler set of tools that forward
// to the daemon via JSON-RPC. The tool definitions are identical to the
// in-process SwarmMcpServer but the implementations use DaemonClient.
#[tool_router]
impl McpStdioProxy {
    #[tool(
        name = "list_peers",
        description = "List agents you're connected to in the swarm. Returns each peer's name and current status (idle or working). Use this to discover who you can collaborate with and what they're doing."
    )]
    async fn list_peers(&self) -> Result<String, String> {
        let connections = self
            .client
            .get_agent_connections(&self.agent_id)
            .await
            .map_err(|e| e.to_string())?;

        // Get full agent list for status info
        let agents = self.client.list_agents().await.map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for peer_id in &connections {
            if let Some(agent) = agents.iter().find(|a| &a.id == peer_id) {
                result.push(serde_json::json!({
                    "id": agent.id,
                    "name": agent.cli,
                    "status": agent.status,
                }));
            }
        }

        serde_json::to_string_pretty(&result).map_err(|e| e.to_string())
    }

    #[tool(
        name = "send_message",
        description = "Send a message to a connected peer agent. The message will be queued in their mailbox and they'll be notified on their next turn. Use this to share information, request help, or coordinate work."
    )]
    async fn send_message(
        &self,
        Parameters(params): Parameters<SendMessageParams>,
    ) -> Result<String, String> {
        self.client
            .send_swarm_message(&self.agent_id, &params.target, &params.body)
            .await
            .map_err(|e| e.to_string())?;
        Ok(serde_json::json!({
            "status": "delivered",
            "target": params.target,
            "body": params.body,
        })
        .to_string())
    }

    #[tool(
        name = "read_mailbox",
        description = "Read and clear all pending messages from your mailbox. Returns messages with sender name, timestamp, and body. Messages are removed after reading. Call this when you receive a nudge about unread messages."
    )]
    async fn read_mailbox(&self) -> Result<String, String> {
        let messages = self
            .client
            .read_mailbox(&self.agent_id)
            .await
            .map_err(|e| e.to_string())?;
        Ok(messages.to_string())
    }

    #[tool(
        name = "spawn_agent",
        description = "Spawn a new agent in the swarm. Requires management permissions. The agent starts with no connections — use connect_agents and then send_message to give it instructions."
    )]
    async fn spawn_agent(
        &self,
        Parameters(params): Parameters<SpawnAgentParams>,
    ) -> Result<String, String> {
        let wd = params
            .working_directory
            .unwrap_or_else(|| ".".to_string());
        let agent_id = self
            .client
            .spawn_agent(wd, params.agent_cli)
            .await
            .map_err(|e| e.to_string())?;
        Ok(serde_json::json!({"agent_id": agent_id}).to_string())
    }

    #[tool(
        name = "kill_agent",
        description = "Kill an existing agent in the swarm. Requires management permissions."
    )]
    async fn kill_agent(
        &self,
        Parameters(params): Parameters<KillAgentParams>,
    ) -> Result<String, String> {
        self.client
            .kill_agent(&params.target)
            .await
            .map_err(|e| e.to_string())?;
        Ok(r#"{"status": "killed"}"#.to_string())
    }

    #[tool(
        name = "connect_agents",
        description = "Create a bidirectional connection between two agents in the swarm. Requires management permissions."
    )]
    async fn connect_agents(
        &self,
        Parameters(params): Parameters<ConnectAgentsParams>,
    ) -> Result<String, String> {
        self.client
            .connect_agents(&params.agent_a, &params.agent_b)
            .await
            .map_err(|e| e.to_string())?;
        Ok(r#"{"status": "connected"}"#.to_string())
    }

    #[tool(
        name = "disconnect_agents",
        description = "Remove the connection between two agents in the swarm. Requires management permissions."
    )]
    async fn disconnect_agents(
        &self,
        Parameters(params): Parameters<DisconnectAgentsParams>,
    ) -> Result<String, String> {
        self.client
            .disconnect_agents(&params.agent_a, &params.agent_b)
            .await
            .map_err(|e| e.to_string())?;
        Ok(r#"{"status": "disconnected"}"#.to_string())
    }
}

#[tool_handler]
impl ServerHandler for McpStdioProxy {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("Emergent swarm communication tools for inter-agent collaboration")
    }
}
