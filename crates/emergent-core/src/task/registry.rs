use std::collections::HashMap;
use std::fmt::Write;
use std::path::Path;

use chrono::Utc;
use emergent_protocol::{Task, TaskState, WorkspaceId};

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
pub struct TaskRegistry {
    tasks: HashMap<String, Task>,
}

impl TaskRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create_task(
        &mut self,
        workspace_id: WorkspaceId,
        title: String,
        description: String,
        agent_id: String,
        blocker_ids: Vec<String>,
        parent_id: Option<String>,
    ) -> String {
        let id = generate_id();
        let task = Task {
            id: id.clone(),
            title,
            description,
            state: TaskState::Pending,
            parent_id,
            blocker_ids,
            agent_id,
            workspace_id,
            created_at: Utc::now(),
        };
        self.tasks.insert(id.clone(), task);
        id
    }

    pub fn get_task(&self, task_id: &str) -> Option<&Task> {
        self.tasks.get(task_id)
    }

    pub fn get_task_mut(&mut self, task_id: &str) -> Option<&mut Task> {
        self.tasks.get_mut(task_id)
    }

    pub fn list_tasks(&self, workspace_id: &WorkspaceId) -> Vec<&Task> {
        self.tasks
            .values()
            .filter(|t| &t.workspace_id == workspace_id)
            .collect()
    }

    pub fn list_tasks_for_agent(&self, agent_id: &str) -> Vec<&Task> {
        self.tasks
            .values()
            .filter(|t| t.agent_id == agent_id)
            .collect()
    }

    /// Returns IDs of Pending tasks in the workspace whose blockers are all Completed.
    pub fn find_unblocked_tasks(&self, workspace_id: &WorkspaceId) -> Vec<String> {
        self.tasks
            .values()
            .filter(|t| &t.workspace_id == workspace_id && t.state.is_pending())
            .filter(|t| {
                t.blocker_ids
                    .iter()
                    .all(|bid| self.tasks.get(bid).is_some_and(|b| b.state.is_completed()))
            })
            .map(|t| t.id.clone())
            .collect()
    }

    /// Check if an agent has any Pending or Working tasks.
    pub fn agent_has_active_tasks(&self, agent_id: &str) -> bool {
        self.tasks
            .values()
            .any(|t| t.agent_id == agent_id && t.state.is_active())
    }

    pub fn all_tasks(&self) -> impl Iterator<Item = &Task> {
        self.tasks.values()
    }

    pub fn all_tasks_mut(&mut self) -> impl Iterator<Item = &mut Task> {
        self.tasks.values_mut()
    }

    /// Remove all tasks for a given workspace from the in-memory registry.
    pub fn delete_tasks_for_workspace(&mut self, workspace_id: &WorkspaceId) {
        self.tasks.retain(|_, t| &t.workspace_id != workspace_id);
    }

    pub async fn save_to_dir(
        &self,
        workspace_id: &WorkspaceId,
        workspace_dir: &Path,
    ) -> Result<(), String> {
        let tasks: Vec<&Task> = self.list_tasks(workspace_id);
        let json = serde_json::to_string_pretty(&tasks)
            .map_err(|e| format!("Failed to serialize tasks: {}", e))?;
        let path = workspace_dir.join("tasks.json");
        let tmp_path = workspace_dir.join("tasks.json.tmp");
        tokio::fs::write(&tmp_path, json)
            .await
            .map_err(|e| format!("Failed to write tasks.json.tmp: {}", e))?;
        tokio::fs::rename(&tmp_path, &path)
            .await
            .map_err(|e| format!("Failed to rename tasks.json.tmp: {}", e))?;
        Ok(())
    }

    pub async fn load_from_dir(&mut self, workspace_dir: &Path) -> Result<(), String> {
        let path = workspace_dir.join("tasks.json");
        if !path.exists() {
            return Ok(());
        }
        let raw = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| format!("Failed to read tasks.json: {}", e))?;
        let tasks: Vec<Task> = serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse tasks.json: {}", e))?;
        for task in tasks {
            self.tasks.insert(task.id.clone(), task);
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
    fn test_create_and_get_task() {
        let mut reg = TaskRegistry::new();
        let id = reg.create_task(
            ws_id(),
            "Build auth".into(),
            "Add JWT auth".into(),
            "agent-1".into(),
            vec![],
            None,
        );
        let task = reg.get_task(&id).unwrap();
        assert_eq!(task.title, "Build auth");
        assert!(task.state.is_pending());
        assert_eq!(task.session_id(), None);
        assert!(task.parent_id.is_none());
    }

    #[test]
    fn test_list_tasks_filters_by_workspace() {
        let mut reg = TaskRegistry::new();
        reg.create_task(ws_id(), "A".into(), "d".into(), "a1".into(), vec![], None);
        reg.create_task(
            WorkspaceId::from("other"),
            "B".into(),
            "d".into(),
            "a2".into(),
            vec![],
            None,
        );
        let list = reg.list_tasks(&ws_id());
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "A");
    }

    #[test]
    fn test_list_tasks_for_agent() {
        let mut reg = TaskRegistry::new();
        reg.create_task(ws_id(), "A".into(), "d".into(), "agent-1".into(), vec![], None);
        reg.create_task(ws_id(), "B".into(), "d".into(), "agent-2".into(), vec![], None);
        let list = reg.list_tasks_for_agent("agent-1");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "A");
    }

    #[test]
    fn test_find_unblocked_tasks_no_blockers() {
        let mut reg = TaskRegistry::new();
        let id = reg.create_task(ws_id(), "A".into(), "d".into(), "a".into(), vec![], None);
        let unblocked = reg.find_unblocked_tasks(&ws_id());
        assert_eq!(unblocked, vec![id]);
    }

    #[test]
    fn test_find_unblocked_tasks_with_pending_blocker() {
        let mut reg = TaskRegistry::new();
        let blocker_id =
            reg.create_task(ws_id(), "Blocker".into(), "d".into(), "a".into(), vec![], None);
        reg.create_task(
            ws_id(),
            "Blocked".into(),
            "d".into(),
            "a".into(),
            vec![blocker_id.clone()],
            None,
        );
        let unblocked = reg.find_unblocked_tasks(&ws_id());
        assert_eq!(unblocked.len(), 1);
        assert_eq!(unblocked[0], blocker_id);
    }

    #[test]
    fn test_find_unblocked_tasks_after_blocker_completes() {
        let mut reg = TaskRegistry::new();
        let blocker_id =
            reg.create_task(ws_id(), "Blocker".into(), "d".into(), "a".into(), vec![], None);
        let blocked_id = reg.create_task(
            ws_id(),
            "Blocked".into(),
            "d".into(),
            "a".into(),
            vec![blocker_id.clone()],
            None,
        );
        reg.get_task_mut(&blocker_id).unwrap().state = TaskState::Completed {
            session_id: "t1".into(),
        };
        let unblocked = reg.find_unblocked_tasks(&ws_id());
        assert!(unblocked.contains(&blocked_id));
    }

    #[test]
    fn test_agent_has_active_tasks() {
        let mut reg = TaskRegistry::new();
        let id = reg.create_task(ws_id(), "A".into(), "d".into(), "agent-1".into(), vec![], None);
        assert!(reg.agent_has_active_tasks("agent-1"));
        assert!(!reg.agent_has_active_tasks("agent-2"));
        reg.get_task_mut(&id).unwrap().state = TaskState::Completed {
            session_id: "t1".into(),
        };
        assert!(!reg.agent_has_active_tasks("agent-1"));
    }

    #[tokio::test]
    async fn test_save_and_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let mut reg = TaskRegistry::new();
        let id = reg.create_task(ws_id(), "A".into(), "desc".into(), "a".into(), vec![], None);
        reg.save_to_dir(&ws_id(), dir.path()).await.unwrap();

        let mut reg2 = TaskRegistry::new();
        reg2.load_from_dir(dir.path()).await.unwrap();
        let task = reg2.get_task(&id).unwrap();
        assert_eq!(task.title, "A");
        assert_eq!(task.description, "desc");
    }
}
