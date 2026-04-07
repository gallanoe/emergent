use std::future::Future;
use std::sync::Arc;

use rmcp::model::{ServerCapabilities, ServerInfo};
use rmcp::{tool_router, ServerHandler};

use crate::agent::AgentManager;
use super::token_registry::TokenRegistry;

// ---------------------------------------------------------------------------
// MCP Handler — serves MCP tools, calls AgentManager directly
// ---------------------------------------------------------------------------

/// MCP server handler that calls AgentManager directly (no socket proxy).
/// Each tool reads the agent_id from the bearer token in the HTTP request parts.
#[derive(Clone)]
pub struct McpHandler {
    #[allow(dead_code)] // Kept for future MCP tools
    manager: Arc<AgentManager>,
    #[allow(dead_code)] // Kept for future MCP tools
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
    #[allow(dead_code)] // Kept for future MCP tools
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
}

#[tool_router]
impl McpHandler {}

impl ServerHandler for McpHandler {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("Emergent MCP server")
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
