pub mod agent_manager;
pub mod config;
pub mod detect;
pub mod mcp;
pub mod swarm;

// Re-exports for backwards compatibility during migration
pub use swarm::mailbox;
pub use swarm::system_prompt;
pub use swarm::topology;
pub use mcp::http_server;
pub use mcp::token_registry;
