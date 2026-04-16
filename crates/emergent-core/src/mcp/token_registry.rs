use std::collections::HashMap;
use std::sync::RwLock;

pub struct TokenRegistry {
    // token -> agent_id
    tokens: RwLock<HashMap<String, String>>,
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

    /// Generate a cryptographically random bearer token for an agent and register it.
    /// Returns the token string.
    pub fn register(&self, agent_id: &str) -> String {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).expect("failed to generate random bytes");
        let token = hex::encode(bytes);
        self.tokens
            .write()
            .unwrap()
            .insert(token.clone(), agent_id.to_string());
        token
    }

    /// Look up the agent_id for a given bearer token.
    pub fn resolve(&self, token: &str) -> Option<String> {
        self.tokens.read().unwrap().get(token).cloned()
    }

    /// Remove all tokens for an agent (called when an agent is killed).
    pub fn revoke_agent(&self, agent_id: &str) {
        self.tokens.write().unwrap().retain(|_, id| id != agent_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_and_resolve() {
        let registry = TokenRegistry::new();
        let token = registry.register("agent-1");
        assert_eq!(registry.resolve(&token), Some("agent-1".to_string()));
    }

    #[test]
    fn unknown_token_returns_none() {
        let registry = TokenRegistry::new();
        assert_eq!(registry.resolve("bogus"), None);
    }

    #[test]
    fn revoke_removes_token() {
        let registry = TokenRegistry::new();
        let token = registry.register("agent-1");
        registry.revoke_agent("agent-1");
        assert_eq!(registry.resolve(&token), None);
    }

    #[test]
    fn tokens_are_unique() {
        let registry = TokenRegistry::new();
        let t1 = registry.register("a");
        let t2 = registry.register("b");
        assert_ne!(t1, t2);
    }
}
