use std::collections::HashMap;
use std::fmt::Write;
use std::path::Path;

use emergent_protocol::{AgentDefinition, AgentProvider, WorkspaceId};

fn generate_id() -> String {
    let mut buf = [0u8; 4];
    getrandom::fill(&mut buf).expect("Failed to generate random bytes");
    let mut id = String::with_capacity(8);
    for byte in &buf {
        write!(id, "{:02x}", byte).unwrap();
    }
    id
}

#[derive(Debug, Default)]
pub struct AgentRegistry {
    agents: HashMap<String, AgentDefinition>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create_agent(
        &mut self,
        workspace_id: WorkspaceId,
        name: String,
        provider: AgentProvider,
    ) -> String {
        self.create_agent_inner(workspace_id, name, provider, None)
    }

    /// Register an agent that spawns an explicit command instead of resolving one
    /// from its provider. Test-only; see [`AgentDefinition::command_override`].
    #[cfg(feature = "test-support")]
    pub fn create_agent_with_command(
        &mut self,
        workspace_id: WorkspaceId,
        name: String,
        provider: AgentProvider,
        command: String,
    ) -> String {
        self.create_agent_inner(workspace_id, name, provider, Some(command))
    }

    fn create_agent_inner(
        &mut self,
        workspace_id: WorkspaceId,
        name: String,
        provider: AgentProvider,
        command_override: Option<String>,
    ) -> String {
        let id = generate_id();
        let definition = AgentDefinition {
            id: id.clone(),
            workspace_id,
            name,
            provider,
            command_override,
        };
        self.agents.insert(id.clone(), definition);
        id
    }

    pub fn get_agent(&self, agent_id: &str) -> Option<&AgentDefinition> {
        self.agents.get(agent_id)
    }

    pub fn update_agent(
        &mut self,
        agent_id: &str,
        name: Option<String>,
        provider: Option<AgentProvider>,
    ) -> Result<(), String> {
        let def = self
            .agents
            .get_mut(agent_id)
            .ok_or_else(|| format!("Agent definition '{}' not found", agent_id))?;
        if let Some(n) = name {
            def.name = n;
        }
        if let Some(p) = provider {
            def.provider = p;
        }
        Ok(())
    }

    pub fn delete_agent(&mut self, agent_id: &str) -> Result<AgentDefinition, String> {
        self.agents
            .remove(agent_id)
            .ok_or_else(|| format!("Agent definition '{}' not found", agent_id))
    }

    pub fn list_definitions(&self, workspace_id: &WorkspaceId) -> Vec<&AgentDefinition> {
        self.agents
            .values()
            .filter(|a| &a.workspace_id == workspace_id)
            .collect()
    }

    pub fn list_all_definitions(&self) -> Vec<&AgentDefinition> {
        self.agents.values().collect()
    }

    // -----------------------------------------------------------------------
    // Persistence
    // -----------------------------------------------------------------------

    /// Save all agent definitions for a workspace to `agents.json` in the
    /// given directory.
    pub async fn save_to_dir(
        &self,
        workspace_id: &WorkspaceId,
        workspace_dir: &Path,
    ) -> Result<(), String> {
        let defs: Vec<&AgentDefinition> = self.list_definitions(workspace_id);
        let json = serde_json::to_string_pretty(&defs)
            .map_err(|e| format!("Failed to serialize agent definitions: {}", e))?;
        let path = workspace_dir.join("agents.json");
        tokio::fs::write(&path, json)
            .await
            .map_err(|e| format!("Failed to write agents.json: {}", e))?;
        Ok(())
    }

    /// Load agent definitions from `agents.json` in the given directory.
    /// Merges into the existing registry (idempotent by ID).
    pub async fn load_from_dir(&mut self, workspace_dir: &Path) -> Result<(), String> {
        let path = workspace_dir.join("agents.json");
        if !path.exists() {
            return Ok(());
        }
        let raw = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| format!("Failed to read agents.json: {}", e))?;
        let defs: Vec<AgentDefinition> = serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse agents.json: {}", e))?;
        for def in defs {
            self.agents.insert(def.id.clone(), def);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws_id() -> WorkspaceId {
        WorkspaceId::from("test-ws")
    }

    #[test]
    fn test_create_and_get_agent() {
        let mut reg = AgentRegistry::new();
        let id = reg.create_agent(ws_id(), "Reviewer".into(), AgentProvider::Claude);
        let def = reg.get_agent(&id).unwrap();
        assert_eq!(def.name, "Reviewer");
        assert_eq!(def.provider, AgentProvider::Claude);
    }

    #[test]
    fn test_update_agent() {
        let mut reg = AgentRegistry::new();
        let id = reg.create_agent(ws_id(), "Old".into(), AgentProvider::Claude);
        reg.update_agent(&id, Some("New".into()), None).unwrap();
        assert_eq!(reg.get_agent(&id).unwrap().name, "New");
    }

    /// A rename must not disturb the harness — `provider` decides whether the
    /// agent can spawn at all, so it may only change when explicitly given.
    #[test]
    fn update_without_provider_leaves_the_harness_alone() {
        let mut reg = AgentRegistry::new();
        let id = reg.create_agent(ws_id(), "Old".into(), AgentProvider::Codex);
        reg.update_agent(&id, Some("New".into()), None).unwrap();
        assert_eq!(reg.get_agent(&id).unwrap().provider, AgentProvider::Codex);

        reg.update_agent(&id, None, Some(AgentProvider::Gemini))
            .unwrap();
        assert_eq!(reg.get_agent(&id).unwrap().provider, AgentProvider::Gemini);
    }

    #[test]
    fn test_delete_agent() {
        let mut reg = AgentRegistry::new();
        let id = reg.create_agent(ws_id(), "A".into(), AgentProvider::Claude);
        reg.delete_agent(&id).unwrap();
        assert!(reg.get_agent(&id).is_none());
    }

    #[test]
    fn test_delete_nonexistent_returns_error() {
        let mut reg = AgentRegistry::new();
        assert!(reg.delete_agent("nope").is_err());
    }

    #[test]
    fn test_list_definitions_filters_by_workspace() {
        let mut reg = AgentRegistry::new();
        reg.create_agent(ws_id(), "A".into(), AgentProvider::Claude);
        reg.create_agent(
            WorkspaceId::from("other"),
            "B".into(),
            AgentProvider::Claude,
        );
        let list = reg.list_definitions(&ws_id());
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "A");
    }

    /// A definition names a harness, not a command, so it resolves to whatever
    /// the catalog currently says — not to any string captured at creation.
    #[tokio::test]
    async fn definitions_resolve_through_the_catalog() {
        let dir = tempfile::tempdir().unwrap();
        tokio::fs::write(
            dir.path().join("agents.json"),
            r#"[{"id":"a1","workspace_id":"ws","name":"Reviewer","provider":"codex"}]"#,
        )
        .await
        .unwrap();

        let mut reg = AgentRegistry::new();
        reg.load_from_dir(dir.path()).await.unwrap();

        let def = reg.get_agent("a1").unwrap();
        assert_eq!(def.provider, AgentProvider::Codex);
        assert_eq!(
            crate::detect::command_for_provider(def.provider),
            "bunx @agentclientprotocol/codex-acp@latest"
        );
    }

    /// An unknown harness must fail the load loudly rather than persisting as a
    /// definition that cannot spawn.
    #[tokio::test]
    async fn load_rejects_unknown_provider() {
        let dir = tempfile::tempdir().unwrap();
        tokio::fs::write(
            dir.path().join("agents.json"),
            r#"[{"id":"a1","workspace_id":"ws","name":"Reviewer","provider":"kodex"}]"#,
        )
        .await
        .unwrap();

        let mut reg = AgentRegistry::new();
        assert!(reg.load_from_dir(dir.path()).await.is_err());
    }

    /// Saving records the harness, never a command string — the whole point of
    /// resolving at spawn time.
    #[tokio::test]
    async fn save_persists_the_harness_not_a_command() {
        let dir = tempfile::tempdir().unwrap();
        let mut reg = AgentRegistry::new();
        let id = reg.create_agent(ws_id(), "Reviewer".into(), AgentProvider::Codex);
        reg.save_to_dir(&ws_id(), dir.path()).await.unwrap();

        let raw = tokio::fs::read_to_string(dir.path().join("agents.json"))
            .await
            .unwrap();
        assert!(
            !raw.contains("bunx") && !raw.contains("\"cli\""),
            "persisted a command string: {}",
            raw
        );
        assert!(raw.contains("\"provider\": \"codex\""));
        assert!(raw.contains(&id));
    }
}
