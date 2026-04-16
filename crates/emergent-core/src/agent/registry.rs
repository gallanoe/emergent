use std::collections::HashMap;
use std::fmt::Write;
use std::path::Path;

use emergent_protocol::{AgentDefinition, WorkspaceId};

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
        role: Option<String>,
        cli: String,
    ) -> String {
        let id = generate_id();
        let definition = AgentDefinition {
            id: id.clone(),
            workspace_id,
            name,
            role,
            cli,
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
        role: Option<String>,
    ) -> Result<(), String> {
        let def = self
            .agents
            .get_mut(agent_id)
            .ok_or_else(|| format!("Agent definition '{}' not found", agent_id))?;
        if let Some(n) = name {
            def.name = n;
        }
        if let Some(r) = role {
            def.role = Some(r);
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
        let id = reg.create_agent(
            ws_id(),
            "Reviewer".into(),
            Some("Review code".into()),
            "claude --acp".into(),
        );
        let def = reg.get_agent(&id).unwrap();
        assert_eq!(def.name, "Reviewer");
        assert_eq!(def.role, Some("Review code".into()));
        assert_eq!(def.cli, "claude --acp");
    }

    #[test]
    fn test_update_agent() {
        let mut reg = AgentRegistry::new();
        let id = reg.create_agent(
            ws_id(),
            "Old".into(),
            Some("old role".into()),
            "claude".into(),
        );
        reg.update_agent(&id, Some("New".into()), None).unwrap();
        assert_eq!(reg.get_agent(&id).unwrap().name, "New");
        assert_eq!(reg.get_agent(&id).unwrap().role, Some("old role".into()));
    }

    #[test]
    fn test_delete_agent() {
        let mut reg = AgentRegistry::new();
        let id = reg.create_agent(ws_id(), "A".into(), Some("r".into()), "c".into());
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
        reg.create_agent(ws_id(), "A".into(), None, "c".into());
        reg.create_agent(
            WorkspaceId::from("other"),
            "B".into(),
            Some("r".into()),
            "c".into(),
        );
        let list = reg.list_definitions(&ws_id());
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "A");
    }
}
