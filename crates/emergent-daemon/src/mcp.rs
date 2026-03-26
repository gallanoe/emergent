use std::future::Future;
use std::sync::Arc;

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{ServerCapabilities, ServerInfo};
use rmcp::{schemars, tool, tool_router, ServerHandler};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Parameter types for MCP tools
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct SendMessageParams {
    #[schemars(description = "The agent ID of the connected peer to send the message to. Use list_peers to find agent IDs.")]
    pub target: String,
    #[schemars(description = "The message text to send")]
    pub body: String,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct SpawnAgentParams {
    #[schemars(
        description = "Name of the agent to spawn. Supported: Claude Code, Codex, Gemini, Kiro, OpenCode"
    )]
    pub agent_name: String,
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
    #[schemars(description = "First agent ID, or \"self\" to refer to yourself")]
    pub agent_a: String,
    #[schemars(description = "Second agent ID, or \"self\" to refer to yourself")]
    pub agent_b: String,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct DisconnectAgentsParams {
    #[schemars(description = "First agent ID, or \"self\" to refer to yourself")]
    pub agent_a: String,
    #[schemars(description = "Second agent ID, or \"self\" to refer to yourself")]
    pub agent_b: String,
}

// ---------------------------------------------------------------------------
// MCP config helper
// ---------------------------------------------------------------------------

/// Build the `McpServerStdio` config to pass to an agent via ACP `session/new`.
///
/// The daemon binary is invoked with `--mcp-stdio --agent-id=<id> --socket=<path>`
/// to serve as an MCP stdio server for a specific agent.
pub fn mcp_config_for_agent(
    agent_id: &str,
    socket_path: &std::path::Path,
) -> Result<agent_client_protocol::McpServer, String> {
    let daemon_path = find_emergentd_binary()
        .ok_or_else(|| "Could not find emergentd binary".to_string())?;

    Ok(agent_client_protocol::McpServer::Stdio(
        agent_client_protocol::McpServerStdio::new("emergent-swarm", daemon_path).args(vec![
            "--mcp-stdio".to_string(),
            format!("--agent-id={}", agent_id),
            format!("--socket={}", socket_path.display()),
        ]),
    ))
}

/// Find the `emergentd` binary. Checks as a sibling of the current executable
/// first (for bundled apps), then falls back to PATH lookup.
fn find_emergentd_binary() -> Option<std::path::PathBuf> {
    // Check sibling of current executable (covers bundled macOS .app)
    if let Ok(current) = std::env::current_exe() {
        let sibling = current.with_file_name("emergentd");
        if sibling.exists() {
            return Some(sibling);
        }
    }

    // Fall back to PATH lookup
    which::which("emergentd").ok()
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
    let (client, mut notification_rx) = match DaemonClient::connect(&socket_path).await {
        Ok(conn) => conn,
        Err(e) => {
            eprintln!("Failed to connect to daemon: {}", e);
            std::process::exit(1);
        }
    };

    let server = McpStdioProxy::new(agent_id, Arc::new(client));

    let (stdin, stdout) = rmcp::transport::stdio();
    match server.serve((stdin, stdout)).await {
        Ok(service) => {
            // Exit if either the MCP service ends OR the daemon connection drops.
            // This prevents orphaned MCP processes when the daemon shuts down.
            tokio::select! {
                _ = service.waiting() => {}
                _ = daemon_connection_closed(&mut notification_rx) => {
                    log::info!("Daemon connection lost, exiting MCP stdio server");
                }
            }
        }
        Err(e) => {
            eprintln!("MCP server error: {}", e);
            std::process::exit(1);
        }
    }
}

/// Wait until the daemon notification channel closes (meaning the daemon connection dropped).
async fn daemon_connection_closed(
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<emergent_protocol::Notification>,
) {
    // When the daemon dies, the reader task in DaemonClient exits,
    // which drops the notification sender, causing recv() to return None.
    while rx.recv().await.is_some() {}
}

// ---------------------------------------------------------------------------
// MCP Stdio Proxy — forwards tool calls to the daemon via JSON-RPC
// ---------------------------------------------------------------------------

/// MCP server that forwards tool calls to the daemon via JSON-RPC over Unix socket.
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

    async fn check_management_permissions(&self) -> Result<bool, String> {
        self.client
            .has_management_permissions(&self.agent_id)
            .await
    }

    /// Resolve "self" to this agent's ID.
    fn resolve_agent_id(&self, id: &str) -> String {
        if id.eq_ignore_ascii_case("self") {
            self.agent_id.clone()
        } else {
            id.to_string()
        }
    }
}

#[tool_router]
impl McpStdioProxy {
    #[tool(
        name = "list_peers",
        description = "List all agents in the swarm. Returns each agent's name, current status, and whether you're connected to them. Connected agents can exchange messages; use connect_agents to connect to unconnected peers."
    )]
    async fn list_peers(&self) -> Result<String, String> {
        let connections = self
            .client
            .get_agent_connections(&self.agent_id)
            .await
            .map_err(|e| e.to_string())?;

        let agents = self.client.list_agents().await.map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for agent in &agents {
            // Skip self
            if agent.id == self.agent_id {
                continue;
            }
            result.push(serde_json::json!({
                "id": agent.id,
                "name": agent.cli,
                "status": agent.status,
                "connected": connections.contains(&agent.id),
            }));
        }

        serde_json::to_string_pretty(&result).map_err(|e| e.to_string())
    }

    #[tool(
        name = "send_message",
        description = "Send a message to a connected peer agent by their agent ID (from list_peers). The message will be queued in their mailbox and they'll be notified on their next turn."
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
        if !self.check_management_permissions().await? {
            return Err("Permission denied: management permissions required".to_string());
        }
        // Resolve display name to CLI command
        let known = self.client.known_agents().await.unwrap_or_default();
        let agent = known.iter().find(|a| a.name.eq_ignore_ascii_case(&params.agent_name));
        let agent = match agent {
            Some(a) => a,
            None => {
                let names: Vec<&str> = known.iter().map(|a| a.name.as_str()).collect();
                return Err(format!(
                    "Unknown agent '{}'. Supported agents: {}",
                    params.agent_name,
                    if names.is_empty() {
                        "none".to_string()
                    } else {
                        names.join(", ")
                    }
                ));
            }
        };
        // Default to spawning agent's working directory
        let wd = match params.working_directory {
            Some(wd) => wd,
            None => {
                let agents = self.client.list_agents().await.unwrap_or_default();
                agents
                    .iter()
                    .find(|a| a.id == self.agent_id)
                    .map(|a| a.working_directory.clone())
                    .unwrap_or_else(|| ".".to_string())
            }
        };
        let agent_id = self
            .client
            .spawn_agent(wd, agent.command.clone())
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
        if !self.check_management_permissions().await? {
            return Err("Permission denied: management permissions required".to_string());
        }
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
        if !self.check_management_permissions().await? {
            return Err("Permission denied: management permissions required".to_string());
        }
        let a = self.resolve_agent_id(&params.agent_a);
        let b = self.resolve_agent_id(&params.agent_b);
        self.client
            .connect_agents(&a, &b)
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
        if !self.check_management_permissions().await? {
            return Err("Permission denied: management permissions required".to_string());
        }
        let a = self.resolve_agent_id(&params.agent_a);
        let b = self.resolve_agent_id(&params.agent_b);
        self.client
            .disconnect_agents(&a, &b)
            .await
            .map_err(|e| e.to_string())?;
        Ok(r#"{"status": "disconnected"}"#.to_string())
    }
}

impl ServerHandler for McpStdioProxy {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("Emergent swarm communication tools for inter-agent collaboration")
    }

    fn list_tools(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParams>,
        _context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> impl Future<Output = Result<rmcp::model::ListToolsResult, rmcp::model::ErrorData>>
           + Send
           + '_ {
        // Always list all tools (including management). Permissions are enforced
        // at call time — each management tool checks has_management_permissions.
        let tools = self.tool_router.list_all();
        async move {
            Ok(rmcp::model::ListToolsResult {
                tools,
                next_cursor: None,
                meta: None,
            })
        }
    }

    fn call_tool(
        &self,
        request: rmcp::model::CallToolRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> impl Future<Output = Result<rmcp::model::CallToolResult, rmcp::model::ErrorData>>
           + Send
           + '_ {
        self.tool_router
            .call(rmcp::handler::server::tool::ToolCallContext::new(
                self, request, context,
            ))
    }

    fn get_tool(&self, name: &str) -> Option<rmcp::model::Tool> {
        self.tool_router
            .list_all()
            .into_iter()
            .find(|t| t.name == name)
    }
}
