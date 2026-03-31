pub mod agent_manager;
pub mod config;
pub mod detect;
pub mod http_server;
pub mod mcp_handler;
pub mod swarm;
pub mod token_registry;

// Re-exports for backwards compatibility during migration
pub use swarm::mailbox;
pub use swarm::system_prompt;
pub use swarm::topology;
