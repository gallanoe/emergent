use crate::error::AppError;
use crate::events::EventEmitter;
use git2::Repository;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceMeta {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub last_opened: String,
}

pub struct WorkspaceService {
    base_dir: PathBuf,
    emitter: Arc<dyn EventEmitter>,
    pub repo: Option<Repository>,
    pub meta: Option<WorkspaceMeta>,
    pub worktree_path: Option<PathBuf>,
}

impl WorkspaceService {
    pub fn new(base_dir: PathBuf, emitter: Arc<dyn EventEmitter>) -> Self {
        Self {
            base_dir,
            emitter,
            repo: None,
            meta: None,
            worktree_path: None,
        }
    }

    pub fn create_workspace(&mut self, name: &str) -> Result<String, AppError> {
        let id = nanoid::nanoid!(12);
        let workspace_dir = self.base_dir.join(&id);
        std::fs::create_dir_all(&workspace_dir).map_err(|e| AppError::Internal {
            message: format!("failed to create workspace dir: {e}"),
        })?;

        // Init bare repo
        let repo_path = workspace_dir.join("repo.git");
        Repository::init_bare(&repo_path)?;

        // Create worktrees dir
        std::fs::create_dir_all(workspace_dir.join("worktrees")).map_err(|e| {
            AppError::Internal {
                message: format!("failed to create worktrees dir: {e}"),
            }
        })?;

        // Write metadata
        let now = chrono::Utc::now().to_rfc3339();
        let meta = WorkspaceMeta {
            id: id.clone(),
            name: name.to_string(),
            created_at: now.clone(),
            last_opened: now,
        };
        let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| AppError::Internal {
            message: format!("failed to serialize metadata: {e}"),
        })?;
        std::fs::write(workspace_dir.join("workspace.json"), meta_json).map_err(|e| {
            AppError::Internal {
                message: format!("failed to write metadata: {e}"),
            }
        })?;

        Ok(id)
    }

    pub fn open_workspace(&mut self, id: &str) -> Result<WorkspaceMeta, AppError> {
        let workspace_dir = self.base_dir.join(id);
        if !workspace_dir.exists() {
            return Err(AppError::Internal {
                message: format!("workspace not found: {id}"),
            });
        }

        let repo_path = workspace_dir.join("repo.git");
        let repo = Repository::open_bare(&repo_path)?;

        let meta_path = workspace_dir.join("workspace.json");
        let meta_str = std::fs::read_to_string(&meta_path).map_err(|e| AppError::Internal {
            message: format!("failed to read metadata: {e}"),
        })?;
        let mut meta: WorkspaceMeta =
            serde_json::from_str(&meta_str).map_err(|e| AppError::Internal {
                message: format!("failed to parse metadata: {e}"),
            })?;

        // Update last_opened
        meta.last_opened = chrono::Utc::now().to_rfc3339();
        let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| AppError::Internal {
            message: format!("failed to serialize metadata: {e}"),
        })?;
        std::fs::write(&meta_path, meta_json).map_err(|e| AppError::Internal {
            message: format!("failed to write metadata: {e}"),
        })?;

        self.repo = Some(repo);
        self.meta = Some(meta.clone());
        self.worktree_path = Some(workspace_dir.join("worktrees").join("main"));

        // Create initial worktree checkout if it doesn't exist
        if !self.worktree_path.as_ref().unwrap().exists() {
            self.init_main_worktree(&workspace_dir)?;
        }

        // Emit with initial tree so frontend can render immediately
        let tree = self.list_tree().unwrap_or_default();
        self.emitter.emit(
            "workspace:opened",
            serde_json::json!({
                "id": meta.id,
                "name": meta.name,
                "branch": "main",
                "tree": tree
            }),
        );

        Ok(meta)
    }

    fn init_main_worktree(&self, workspace_dir: &Path) -> Result<(), AppError> {
        let repo = self.repo.as_ref().unwrap();
        let worktree_path = workspace_dir.join("worktrees").join("main");

        if repo.head().is_err() {
            // Empty repo — no commits yet. Create an initial empty commit so we have a HEAD.
            let sig = repo.signature().or_else(|_| {
                git2::Signature::now("Emergent", "emergent@local")
            })?;
            let tree_oid = repo.treebuilder(None)?.write()?;
            let tree = repo.find_tree(tree_oid)?;
            repo.commit(Some("HEAD"), &sig, &sig, "Initial workspace", &tree, &[])?;
        }

        // Use git2 worktree API to check out main branch
        if !worktree_path.exists() {
            let head = repo.head()?.peel_to_commit()?;
            let branch = repo
                .find_branch("main", git2::BranchType::Local)
                .or_else(|_| repo.branch("main", &head, false))?;
            repo.worktree(
                "main",
                &worktree_path,
                Some(git2::WorktreeAddOptions::new().reference(Some(branch.get()))),
            )?;
        }

        Ok(())
    }

    pub fn list_tree(&self) -> Result<Vec<serde_json::Value>, AppError> {
        Ok(vec![])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::TestEmitter;
    use tempfile::TempDir;

    fn setup() -> (TempDir, WorkspaceService) {
        let tmp = TempDir::new().unwrap();
        let emitter = Arc::new(TestEmitter::new());
        let svc = WorkspaceService::new(tmp.path().to_path_buf(), emitter);
        (tmp, svc)
    }

    #[test]
    fn test_create_workspace_returns_id() {
        let (_tmp, mut svc) = setup();
        let id = svc.create_workspace("My Notes").unwrap();
        assert!(!id.is_empty());
    }

    #[test]
    fn test_create_workspace_creates_bare_repo() {
        let (tmp, mut svc) = setup();
        let id = svc.create_workspace("My Notes").unwrap();
        let repo_path = tmp.path().join(&id).join("repo.git");
        assert!(repo_path.exists());
        let repo = Repository::open_bare(&repo_path).unwrap();
        assert!(repo.is_bare());
    }

    #[test]
    fn test_create_workspace_writes_metadata() {
        let (tmp, mut svc) = setup();
        let id = svc.create_workspace("My Notes").unwrap();
        let meta_path = tmp.path().join(&id).join("workspace.json");
        assert!(meta_path.exists());
        let meta: WorkspaceMeta =
            serde_json::from_str(&std::fs::read_to_string(meta_path).unwrap()).unwrap();
        assert_eq!(meta.name, "My Notes");
        assert_eq!(meta.id, id);
    }

    #[test]
    fn test_open_workspace_loads_repo() {
        let (_tmp, mut svc) = setup();
        let id = svc.create_workspace("My Notes").unwrap();
        svc.open_workspace(&id).unwrap();
        assert!(svc.repo.is_some());
        assert!(svc.meta.is_some());
        assert_eq!(svc.meta.as_ref().unwrap().name, "My Notes");
    }

    #[test]
    fn test_open_nonexistent_workspace_errors() {
        let (_tmp, mut svc) = setup();
        let result = svc.open_workspace("nonexistent");
        assert!(result.is_err());
    }
}
