use std::future::Future;
use std::sync::Arc;

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{ServerCapabilities, ServerInfo};
use rmcp::{schemars, tool, tool_router, ServerHandler};
use serde::{Deserialize, Serialize};

use crate::agent::AgentManager;
use super::token_registry::TokenRegistry;

// ---------------------------------------------------------------------------
// Parameter types for MCP tools
// ---------------------------------------------------------------------------

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
// MCP Handler — serves MCP tools, calls AgentManager directly
// ---------------------------------------------------------------------------

/// MCP server handler that calls AgentManager directly (no socket proxy).
/// Each tool reads the agent_id from the bearer token in the HTTP request parts.
#[derive(Clone)]
pub struct McpHandler {
    manager: Arc<AgentManager>,
    token_registry: Arc<TokenRegistry>,
    tool_router: rmcp::handler::server::router::tool::ToolRouter<Self>,
}

impl McpHandler {
    pub fn new(manager: Arc<AgentManager>, token_registry: Arc<TokenRegistry>) -> Self {
        Self {
            manager,
            token_registry,
            tool_router: Self::tool_router(),
        }
    }

    /// Extract the agent_id from the HTTP request parts.
    /// The bearer token is in the Authorization header; we resolve it via TokenRegistry.
    fn agent_id_from_parts(&self, parts: &http::request::Parts) -> Result<String, String> {
        let auth = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(|| "Missing or invalid Authorization header".to_string())?;
        self.token_registry
            .resolve(auth)
            .ok_or_else(|| "Invalid bearer token".to_string())
    }

    fn resolve_agent_id(&self, agent_id: &str, id: &str) -> String {
        if id.eq_ignore_ascii_case("self") {
            agent_id.to_string()
        } else {
            id.to_string()
        }
    }
}

#[tool_router]
impl McpHandler {
    #[tool(
        name = "list_peers",
        description = "List all agents in the swarm. Returns each agent's name, current status, and whether you're connected to them. Connected agents can exchange messages; use connect_agents to connect to unconnected peers."
    )]
    async fn list_peers(
        &self,
        rmcp::handler::server::tool::Extension(parts): rmcp::handler::server::tool::Extension<
            http::request::Parts,
        >,
    ) -> Result<String, String> {
        let agent_id = self.agent_id_from_parts(&parts)?;
        let connections = self.manager.get_connections(&agent_id).await;
        let agents = self.manager.list_agents().await;

        // Resolve caller's workspace_id so we only show same-workspace peers
        let caller_workspace_id = agents
            .iter()
            .find(|a| a.id == agent_id)
            .map(|a| a.workspace_id.clone())
            .ok_or_else(|| format!("Calling agent '{}' not found", agent_id))?;

        let mut result = Vec::new();
        for agent in &agents {
            if agent.id == agent_id {
                continue;
            }
            // Only list agents in the same workspace
            if agent.workspace_id != caller_workspace_id {
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
        name = "kill_agent",
        description = "Kill an existing agent in the swarm. Requires management permissions."
    )]
    async fn kill_agent(
        &self,
        rmcp::handler::server::tool::Extension(parts): rmcp::handler::server::tool::Extension<
            http::request::Parts,
        >,
        Parameters(params): Parameters<KillAgentParams>,
    ) -> Result<String, String> {
        let agent_id = self.agent_id_from_parts(&parts)?;
        if !self.manager.has_management_permissions(&agent_id).await {
            return Err("Permission denied: management permissions required".to_string());
        }
        self.manager
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
        rmcp::handler::server::tool::Extension(parts): rmcp::handler::server::tool::Extension<
            http::request::Parts,
        >,
        Parameters(params): Parameters<ConnectAgentsParams>,
    ) -> Result<String, String> {
        let agent_id = self.agent_id_from_parts(&parts)?;
        if !self.manager.has_management_permissions(&agent_id).await {
            return Err("Permission denied: management permissions required".to_string());
        }
        let a = self.resolve_agent_id(&agent_id, &params.agent_a);
        let b = self.resolve_agent_id(&agent_id, &params.agent_b);
        self.manager.connect_agents(&a, &b).await?;
        Ok(r#"{"status": "connected"}"#.to_string())
    }

    #[tool(
        name = "disconnect_agents",
        description = "Remove the connection between two agents in the swarm. Requires management permissions."
    )]
    async fn disconnect_agents(
        &self,
        rmcp::handler::server::tool::Extension(parts): rmcp::handler::server::tool::Extension<
            http::request::Parts,
        >,
        Parameters(params): Parameters<DisconnectAgentsParams>,
    ) -> Result<String, String> {
        let agent_id = self.agent_id_from_parts(&parts)?;
        if !self.manager.has_management_permissions(&agent_id).await {
            return Err("Permission denied: management permissions required".to_string());
        }
        let a = self.resolve_agent_id(&agent_id, &params.agent_a);
        let b = self.resolve_agent_id(&agent_id, &params.agent_b);
        self.manager.disconnect_agents(&a, &b).await;
        Ok(r#"{"status": "disconnected"}"#.to_string())
    }
}

impl ServerHandler for McpHandler {
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
