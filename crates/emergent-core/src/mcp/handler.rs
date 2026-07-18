use std::future::Future;
use std::sync::Arc;

use rmcp::handler::server::tool::Extension;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{ServerCapabilities, ServerInfo};
use rmcp::{tool, tool_router, ServerHandler};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::token_registry::TokenRegistry;
use crate::agent::AgentManager;
use crate::task::{SubscribeMode, TaskManager};

/// MCP server handler that calls AgentManager directly (no socket proxy).
/// Each tool reads the agent_id from the bearer token in the HTTP request parts.
#[derive(Clone)]
pub struct McpHandler {
    manager: Arc<AgentManager>,
    token_registry: Arc<TokenRegistry>,
    task_manager: Arc<TaskManager>,
    tool_router: rmcp::handler::server::router::tool::ToolRouter<Self>,
}

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
    /// Subscribe the calling session to this task's status updates.
    /// "milestones" delivers start + completion notifications;
    /// "all" additionally delivers each update_task progress message.
    /// Omit the field to opt out.
    pub subscribe: Option<SubscribeMode>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct UpdateTaskParams {
    /// Human-readable progress description routed to the task's creator.
    pub description: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CompleteTaskParams {
    /// Optional summary describing what was accomplished. Sent to the session that created this task if it subscribed.
    pub summary: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListTasksParams {
    /// Filter by status (pending, working, completed, failed)
    pub status: Option<String>,
    /// Filter by agent definition ID
    pub agent_id: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SearchTasksParams {
    /// Filter by status (pending, working, completed, failed)
    pub status: Option<String>,
    /// Filter by agent definition ID
    pub agent_id: Option<String>,
    /// Case-insensitive substring match on the task title
    pub name: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SearchConversationsParams {
    /// Filter by status (initializing, idle, working, error, dead)
    pub status: Option<String>,
    /// Filter by agent definition ID
    pub agent_id: Option<String>,
    /// Filter to the conversation bound to this task ID
    pub task_id: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SendMessageParams {
    /// Target conversation (thread) ID to deliver the message to. Get IDs from
    /// `search_conversations`. Must be in your workspace.
    pub to: String,
    /// Message body delivered to the target agent on its next turn.
    pub content: String,
}

#[derive(Debug, Serialize)]
struct AvailableAgent {
    id: String,
    name: String,
}

#[derive(Debug, Serialize)]
struct SendMessageResult {
    to: String,
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct CreateTaskResult {
    task_id: String,
}

#[derive(Debug, Serialize)]
struct UpdateTaskResult {
    task_id: String,
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct CompleteTaskResult {
    task_id: String,
    status: &'static str,
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

    /// Return true when the caller's token was minted for a task session.
    ///
    /// Used to gate task-only tools in `list_tools`. Consults the token
    /// registry rather than the live thread map because `list_tools` fires
    /// during the ACP handshake, before the `ThreadHandle` is inserted into
    /// `ThreadManager.threads`. The task_id was recorded at token-mint time
    /// (synchronous, pre-spawn), so it's already visible here.
    fn is_task_session(&self, context: &rmcp::service::RequestContext<rmcp::RoleServer>) -> bool {
        let Some(parts) = context.extensions.get::<http::request::Parts>() else {
            return false;
        };
        let Some(token) = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
        else {
            return false;
        };
        self.token_registry.resolve_task_id(token).is_some()
    }
}

#[tool_router]
impl McpHandler {
    /// Create a new task assigned to an agent. Use the `subscribe` field to receive
    /// lifecycle notifications: "milestones" for start+completion, "all" for every update.
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
                Some(thread_id.clone()),
                params.subscribe,
            )
            .await
            .map_err(|e| rmcp::model::ErrorData::internal_error(e, None))?;

        let json = serde_json::to_string_pretty(&CreateTaskResult {
            task_id: task_id.clone(),
        })
        .map_err(|e| rmcp::model::ErrorData::internal_error(e.to_string(), None))?;
        Ok(rmcp::model::CallToolResult::success(vec![
            rmcp::model::Content::text(json),
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

    /// Search tasks in the caller's workspace, filtering by status, assigned
    /// agent, and/or a case-insensitive title substring. All filters are
    /// optional and combine with AND.
    #[tool]
    async fn search_tasks(
        &self,
        Extension(parts): Extension<http::request::Parts>,
        Parameters(params): Parameters<SearchTasksParams>,
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
        if let Some(ref name) = params.name {
            let needle = name.to_lowercase();
            tasks.retain(|t| t.title.to_lowercase().contains(&needle));
        }

        let json = serde_json::to_string_pretty(&tasks)
            .map_err(|e| rmcp::model::ErrorData::internal_error(e.to_string(), None))?;
        Ok(rmcp::model::CallToolResult::success(vec![
            rmcp::model::Content::text(json),
        ]))
    }

    /// Search conversations (agent threads) in the caller's workspace, filtering
    /// by status, agent, and/or bound task ID. All filters are optional and
    /// combine with AND. Returns live and dormant conversations; dormant ones
    /// report status "dead".
    #[tool]
    async fn search_conversations(
        &self,
        Extension(parts): Extension<http::request::Parts>,
        Parameters(params): Parameters<SearchConversationsParams>,
    ) -> Result<rmcp::model::CallToolResult, rmcp::model::ErrorData> {
        let thread_id = self
            .agent_id_from_parts(&parts)
            .map_err(|e| rmcp::model::ErrorData::internal_error(e, None))?;
        let workspace_id = self
            .manager
            .get_thread_workspace_id(&thread_id)
            .await
            .ok_or_else(|| rmcp::model::ErrorData::internal_error("Thread not found", None))?;

        let mut conversations = self.manager.list_conversations(&workspace_id).await;

        if let Some(ref s) = params.status {
            if !matches!(
                s.as_str(),
                "initializing" | "idle" | "working" | "error" | "dead"
            ) {
                return Err(rmcp::model::ErrorData::invalid_params(
                    format!("Invalid status: {}", s),
                    None,
                ));
            }
            conversations.retain(|c| &c.status == s);
        }
        if let Some(ref aid) = params.agent_id {
            conversations.retain(|c| &c.agent_id == aid);
        }
        if let Some(ref tid) = params.task_id {
            conversations.retain(|c| c.task_id.as_deref() == Some(tid.as_str()));
        }

        let json = serde_json::to_string_pretty(&conversations)
            .map_err(|e| rmcp::model::ErrorData::internal_error(e.to_string(), None))?;
        Ok(rmcp::model::CallToolResult::success(vec![
            rmcp::model::Content::text(json),
        ]))
    }

    /// Send a message to another conversation (thread) in your workspace. The
    /// message is held in the target's queue and delivered on its next turn; if
    /// the target is dormant it is woken to receive it. Fire-and-forget: returns
    /// once queued, not when the target reads it.
    #[tool]
    async fn send_message(
        &self,
        Extension(parts): Extension<http::request::Parts>,
        Parameters(params): Parameters<SendMessageParams>,
    ) -> Result<rmcp::model::CallToolResult, rmcp::model::ErrorData> {
        let from_thread_id = self
            .agent_id_from_parts(&parts)
            .map_err(|e| rmcp::model::ErrorData::internal_error(e, None))?;
        let from_workspace = self
            .manager
            .get_thread_workspace_id(&from_thread_id)
            .await
            .ok_or_else(|| rmcp::model::ErrorData::internal_error("Sender thread not found", None))?;

        // Reject self-sends and cross-workspace sends.
        if params.to == from_thread_id {
            return Err(rmcp::model::ErrorData::invalid_params(
                "Cannot send a message to yourself",
                None,
            ));
        }
        let to_workspace = self
            .manager
            .thread_workspace(&params.to)
            .await
            .ok_or_else(|| {
                rmcp::model::ErrorData::invalid_params(
                    format!("Target conversation '{}' not found", params.to),
                    None,
                )
            })?;
        if to_workspace != from_workspace {
            return Err(rmcp::model::ErrorData::invalid_params(
                "Target conversation is in a different workspace",
                None,
            ));
        }

        let from_name = self
            .manager
            .get_agent_name_for_thread(&from_thread_id)
            .await
            .unwrap_or_else(|| from_thread_id.clone());

        self.manager
            .enqueue_message(
                &params.to,
                crate::agent::queue::MessageSource::Thread {
                    from_thread_id: from_thread_id.clone(),
                    from_name,
                },
                params.content,
            )
            .await
            .map_err(|e| rmcp::model::ErrorData::internal_error(e, None))?;

        let json = serde_json::to_string_pretty(&SendMessageResult {
            to: params.to,
            status: "queued",
        })
        .map_err(|e| rmcp::model::ErrorData::internal_error(e.to_string(), None))?;
        Ok(rmcp::model::CallToolResult::success(vec![
            rmcp::model::Content::text(json),
        ]))
    }

    /// List agent definitions available in the caller's workspace.
    #[tool]
    async fn list_agents(
        &self,
        Extension(parts): Extension<http::request::Parts>,
    ) -> Result<rmcp::model::CallToolResult, rmcp::model::ErrorData> {
        let thread_id = self
            .agent_id_from_parts(&parts)
            .map_err(|e| rmcp::model::ErrorData::internal_error(e, None))?;
        let workspace_id = self
            .manager
            .get_thread_workspace_id(&thread_id)
            .await
            .ok_or_else(|| rmcp::model::ErrorData::internal_error("Thread not found", None))?;

        let mut agents: Vec<AvailableAgent> = self
            .manager
            .list_agent_definitions(&workspace_id)
            .await
            .into_iter()
            .map(|agent| AvailableAgent {
                id: agent.id,
                name: agent.name,
            })
            .collect();
        agents.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));

        let json = serde_json::to_string_pretty(&agents)
            .map_err(|e| rmcp::model::ErrorData::internal_error(e.to_string(), None))?;
        Ok(rmcp::model::CallToolResult::success(vec![
            rmcp::model::Content::text(json),
        ]))
    }

    /// Post a progress update on the current task. Sent to the session that created this task if it subscribed.
    #[tool]
    async fn update_task(
        &self,
        Extension(parts): Extension<http::request::Parts>,
        Parameters(params): Parameters<UpdateTaskParams>,
    ) -> Result<rmcp::model::CallToolResult, rmcp::model::ErrorData> {
        let task_id = self
            .task_id_from_parts(&parts)
            .await
            .map_err(|e| rmcp::model::ErrorData::internal_error(e, None))?;

        self.task_manager
            .post_update(&task_id, &params.description)
            .await
            .map_err(|e| rmcp::model::ErrorData::internal_error(e, None))?;

        let json = serde_json::to_string_pretty(&UpdateTaskResult {
            task_id,
            status: "ok",
        })
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
        Parameters(params): Parameters<CompleteTaskParams>,
    ) -> Result<rmcp::model::CallToolResult, rmcp::model::ErrorData> {
        let task_id = self
            .task_id_from_parts(&parts)
            .await
            .map_err(|e| rmcp::model::ErrorData::internal_error(e, None))?;

        self.task_manager
            .complete_task(&task_id, params.summary)
            .await
            .map_err(|e| rmcp::model::ErrorData::internal_error(e, None))?;

        let json = serde_json::to_string_pretty(&CompleteTaskResult {
            task_id,
            status: "completed",
        })
        .map_err(|e| rmcp::model::ErrorData::internal_error(e.to_string(), None))?;
        Ok(rmcp::model::CallToolResult::success(vec![
            rmcp::model::Content::text(json),
        ]))
    }
}

impl ServerHandler for McpHandler {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("Emergent MCP server")
    }

    #[allow(clippy::manual_async_fn)]
    fn list_tools(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParams>,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> impl Future<Output = Result<rmcp::model::ListToolsResult, rmcp::model::ErrorData>> + Send + '_
    {
        async move {
            let is_task_session = self.is_task_session(&context);
            let tools = self
                .tool_router
                .list_all()
                .into_iter()
                .filter(|t| {
                    is_task_session || (t.name != "complete_task" && t.name != "update_task")
                })
                .collect();
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
