use std::future::Future;
use std::sync::Arc;

use rmcp::handler::server::tool::Extension;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{ServerCapabilities, ServerInfo};
use rmcp::{tool, tool_router, ServerHandler};
use schemars::JsonSchema;
use serde::Deserialize;

use super::token_registry::TokenRegistry;
use crate::agent::AgentManager;
use crate::task::TaskManager;

// ---------------------------------------------------------------------------
// MCP Handler — serves MCP tools, calls AgentManager directly
// ---------------------------------------------------------------------------

/// MCP server handler that calls AgentManager directly (no socket proxy).
/// Each tool reads the agent_id from the bearer token in the HTTP request parts.
#[derive(Clone)]
pub struct McpHandler {
    manager: Arc<AgentManager>,
    token_registry: Arc<TokenRegistry>,
    task_manager: Arc<TaskManager>,
    tool_router: rmcp::handler::server::router::tool::ToolRouter<Self>,
}

// -- Parameter structs for MCP tools --

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateTaskParams {
    /// Task title
    pub title: String,
    /// Task description (becomes the agent's prompt)
    pub description: String,
    /// Agent definition ID to assign the task to
    pub agent_id: String,
    /// Optional list of task IDs that must complete first
    pub blocker_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListTasksParams {
    /// Filter by status (pending, working, completed, failed)
    pub status: Option<String>,
    /// Filter by agent definition ID
    pub agent_id: Option<String>,
}

impl McpHandler {
    pub fn new(
        manager: Arc<AgentManager>,
        token_registry: Arc<TokenRegistry>,
        task_manager: Arc<TaskManager>,
    ) -> Self {
        Self {
            manager,
            token_registry,
            task_manager,
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

    /// Resolve the task_id for the calling thread's session.
    async fn task_id_from_parts(&self, parts: &http::request::Parts) -> Result<String, String> {
        let thread_id = self.agent_id_from_parts(parts)?;
        self.manager
            .get_thread_task_id(&thread_id)
            .await
            .ok_or_else(|| "This session is not a task session".to_string())
    }
}

#[tool_router]
impl McpHandler {
    /// Create a new task assigned to an agent
    #[tool]
    async fn create_task(
        &self,
        Extension(parts): Extension<http::request::Parts>,
        Parameters(params): Parameters<CreateTaskParams>,
    ) -> Result<rmcp::model::CallToolResult, rmcp::model::ErrorData> {
        let thread_id = self
            .agent_id_from_parts(&parts)
            .map_err(|e| rmcp::model::ErrorData::internal_error(e, None))?;
        let workspace_id = self
            .manager
            .get_thread_workspace_id(&thread_id)
            .await
            .ok_or_else(|| rmcp::model::ErrorData::internal_error("Thread not found", None))?;
        let parent_id = self.manager.get_thread_task_id(&thread_id).await;

        let task_id = self
            .task_manager
            .create_task(
                workspace_id,
                params.title,
                params.description,
                params.agent_id,
                params.blocker_ids.unwrap_or_default(),
                parent_id,
            )
            .await
            .map_err(|e| rmcp::model::ErrorData::internal_error(e, None))?;

        Ok(rmcp::model::CallToolResult::success(vec![
            rmcp::model::Content::text(format!("Task created: {}", task_id)),
        ]))
    }

    /// List tasks in the workspace
    #[tool]
    async fn list_tasks(
        &self,
        Extension(parts): Extension<http::request::Parts>,
        Parameters(params): Parameters<ListTasksParams>,
    ) -> Result<rmcp::model::CallToolResult, rmcp::model::ErrorData> {
        let thread_id = self
            .agent_id_from_parts(&parts)
            .map_err(|e| rmcp::model::ErrorData::internal_error(e, None))?;
        let workspace_id = self
            .manager
            .get_thread_workspace_id(&thread_id)
            .await
            .ok_or_else(|| rmcp::model::ErrorData::internal_error("Thread not found", None))?;

        let mut tasks = self.task_manager.list_tasks(&workspace_id).await;

        if let Some(ref s) = params.status {
            let predicate: fn(&emergent_protocol::TaskState) -> bool = match s.as_str() {
                "pending" => emergent_protocol::TaskState::is_pending,
                "working" => emergent_protocol::TaskState::is_working,
                "completed" => emergent_protocol::TaskState::is_completed,
                "failed" => emergent_protocol::TaskState::is_failed,
                _ => {
                    return Err(rmcp::model::ErrorData::invalid_params(
                        format!("Invalid status: {}", s),
                        None,
                    ))
                }
            };
            tasks.retain(|t| predicate(&t.state));
        }
        if let Some(ref aid) = params.agent_id {
            tasks.retain(|t| &t.agent_id == aid);
        }

        let json = serde_json::to_string_pretty(&tasks)
            .map_err(|e| rmcp::model::ErrorData::internal_error(e.to_string(), None))?;
        Ok(rmcp::model::CallToolResult::success(vec![
            rmcp::model::Content::text(json),
        ]))
    }

    /// Mark the current task as completed. Only available in task sessions.
    #[tool]
    async fn complete_task(
        &self,
        Extension(parts): Extension<http::request::Parts>,
    ) -> Result<rmcp::model::CallToolResult, rmcp::model::ErrorData> {
        let task_id = self
            .task_id_from_parts(&parts)
            .await
            .map_err(|e| rmcp::model::ErrorData::internal_error(e, None))?;

        self.task_manager
            .complete_task(&task_id)
            .await
            .map_err(|e| rmcp::model::ErrorData::internal_error(e, None))?;

        Ok(rmcp::model::CallToolResult::success(vec![
            rmcp::model::Content::text(format!("Task {} completed", task_id)),
        ]))
    }
}

impl ServerHandler for McpHandler {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("Emergent MCP server")
    }

    fn list_tools(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParams>,
        _context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> impl Future<Output = Result<rmcp::model::ListToolsResult, rmcp::model::ErrorData>> + Send + '_
    {
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
    ) -> impl Future<Output = Result<rmcp::model::CallToolResult, rmcp::model::ErrorData>> + Send + '_
    {
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
