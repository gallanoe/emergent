use std::collections::HashMap;
use std::sync::RwLock;

/// Metadata stored alongside a bearer token.
///
/// Populated at token-mint time (synchronously, before the agent subprocess
/// spawns) so the MCP server can answer authorization and session-type
/// questions without racing against the async thread-handle insertion in
/// `ThreadManager`.
#[derive(Clone, Debug)]
struct TokenEntry {
    thread_id: String,
    task_id: Option<String>,
}

pub struct TokenRegistry {
    tokens: RwLock<HashMap<String, TokenEntry>>,
}

impl Default for TokenRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl TokenRegistry {
    pub fn new() -> Self {
        Self {
            tokens: RwLock::new(HashMap::new()),
        }
    }

    /// Generate a cryptographically random bearer token for a thread and
    /// register it. `task_id` must be `Some` iff the thread is a task session.
    pub fn register(&self, thread_id: &str, task_id: Option<String>) -> String {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).expect("failed to generate random bytes");
        let token = hex::encode(bytes);
        self.tokens.write().unwrap().insert(
            token.clone(),
            TokenEntry {
                thread_id: thread_id.to_string(),
                task_id,
            },
        );
        token
    }

    /// Look up the thread_id for a given bearer token.
    pub fn resolve(&self, token: &str) -> Option<String> {
        self.tokens
            .read()
            .unwrap()
            .get(token)
            .map(|entry| entry.thread_id.clone())
    }

    /// Look up the task_id the token was minted with, if any. Returns `None`
    /// for conversation sessions or unknown tokens.
    pub fn resolve_task_id(&self, token: &str) -> Option<String> {
        self.tokens
            .read()
            .unwrap()
            .get(token)
            .and_then(|entry| entry.task_id.clone())
    }

    /// Remove all tokens for a thread (called when a thread is killed).
    pub fn revoke_agent(&self, thread_id: &str) {
        self.tokens
            .write()
            .unwrap()
            .retain(|_, entry| entry.thread_id != thread_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_and_resolve() {
        let registry = TokenRegistry::new();
        let token = registry.register("agent-1", None);
        assert_eq!(registry.resolve(&token), Some("agent-1".to_string()));
        assert_eq!(registry.resolve_task_id(&token), None);
    }

    #[test]
    fn register_with_task_exposes_task_id() {
        let registry = TokenRegistry::new();
        let token = registry.register("agent-1", Some("task-42".to_string()));
        assert_eq!(registry.resolve(&token), Some("agent-1".to_string()));
        assert_eq!(
            registry.resolve_task_id(&token),
            Some("task-42".to_string())
        );
    }

    #[test]
    fn unknown_token_returns_none() {
        let registry = TokenRegistry::new();
        assert_eq!(registry.resolve("bogus"), None);
        assert_eq!(registry.resolve_task_id("bogus"), None);
    }

    #[test]
    fn revoke_removes_token() {
        let registry = TokenRegistry::new();
        let token = registry.register("agent-1", Some("task-1".to_string()));
        registry.revoke_agent("agent-1");
        assert_eq!(registry.resolve(&token), None);
        assert_eq!(registry.resolve_task_id(&token), None);
    }

    #[test]
    fn tokens_are_unique() {
        let registry = TokenRegistry::new();
        let t1 = registry.register("a", None);
        let t2 = registry.register("b", None);
        assert_ne!(t1, t2);
    }
}
