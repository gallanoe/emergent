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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub kind: String, // "file" or "folder"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeNode>>,
}

pub struct WorkspaceService {
    base_dir: PathBuf,
    pub(crate) emitter: Arc<dyn EventEmitter>,
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

    pub fn repo(&self) -> Option<&Repository> {
        self.repo.as_ref()
    }

    pub fn worktree_path(&self) -> Option<&Path> {
        self.worktree_path.as_deref()
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

    pub(crate) fn worktree_dir(&self) -> Result<&Path, AppError> {
        self.worktree_path
            .as_deref()
            .ok_or(AppError::WorkspaceNotOpen)
    }

    pub fn create_document(&mut self, path: &str) -> Result<(), AppError> {
        let full_path = self.worktree_dir()?.join(path);
        if full_path.exists() {
            return Err(AppError::DocumentAlreadyExists {
                path: path.to_string(),
            });
        }
        if let Some(parent) = full_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| AppError::Internal {
                message: format!("failed to create parent dirs: {e}"),
            })?;
        }
        std::fs::write(&full_path, "").map_err(|e| AppError::Internal {
            message: format!("failed to create document: {e}"),
        })?;
        self.emitter.emit("tree:changed", serde_json::json!({}));
        Ok(())
    }

    pub fn read_document(&self, path: &str) -> Result<String, AppError> {
        let full_path = self.worktree_dir()?.join(path);
        if !full_path.exists() {
            return Err(AppError::DocumentNotFound {
                path: path.to_string(),
            });
        }
        std::fs::read_to_string(&full_path).map_err(|e| AppError::Internal {
            message: format!("failed to read document: {e}"),
        })
    }

    pub fn write_document(&mut self, path: &str, content: &str) -> Result<(), AppError> {
        let full_path = self.worktree_dir()?.join(path);
        if !full_path.exists() {
            return Err(AppError::DocumentNotFound {
                path: path.to_string(),
            });
        }
        std::fs::write(&full_path, content).map_err(|e| AppError::Internal {
            message: format!("failed to write document: {e}"),
        })?;
        self.emitter
            .emit("document:changed", serde_json::json!({"path": path}));
        Ok(())
    }

    pub fn delete_document(&mut self, path: &str) -> Result<(), AppError> {
        let full_path = self.worktree_dir()?.join(path);
        if !full_path.exists() {
            return Err(AppError::DocumentNotFound {
                path: path.to_string(),
            });
        }
        std::fs::remove_file(&full_path).map_err(|e| AppError::Internal {
            message: format!("failed to delete document: {e}"),
        })?;
        self.emitter.emit("tree:changed", serde_json::json!({}));
        Ok(())
    }

    pub fn move_document(&mut self, old_path: &str, new_path: &str) -> Result<(), AppError> {
        let old_full = self.worktree_dir()?.join(old_path);
        let new_full = self.worktree_dir()?.join(new_path);
        if !old_full.exists() {
            return Err(AppError::DocumentNotFound {
                path: old_path.to_string(),
            });
        }
        if let Some(parent) = new_full.parent() {
            std::fs::create_dir_all(parent).map_err(|e| AppError::Internal {
                message: format!("failed to create parent dirs: {e}"),
            })?;
        }
        std::fs::rename(&old_full, &new_full).map_err(|e| AppError::Internal {
            message: format!("failed to move document: {e}"),
        })?;
        self.emitter.emit("tree:changed", serde_json::json!({}));
        Ok(())
    }

    pub fn create_folder(&mut self, path: &str) -> Result<(), AppError> {
        let full_path = self.worktree_dir()?.join(path);
        std::fs::create_dir_all(&full_path).map_err(|e| AppError::Internal {
            message: format!("failed to create folder: {e}"),
        })?;
        // Write .gitkeep so git tracks the empty dir
        std::fs::write(full_path.join(".gitkeep"), "").map_err(|e| AppError::Internal {
            message: format!("failed to write .gitkeep: {e}"),
        })?;
        self.emitter.emit("tree:changed", serde_json::json!({}));
        Ok(())
    }

    pub fn delete_folder(&mut self, path: &str) -> Result<(), AppError> {
        let full_path = self.worktree_dir()?.join(path);
        if !full_path.exists() {
            return Err(AppError::FolderNotFound {
                path: path.to_string(),
            });
        }
        std::fs::remove_dir_all(&full_path).map_err(|e| AppError::Internal {
            message: format!("failed to delete folder: {e}"),
        })?;
        self.emitter.emit("tree:changed", serde_json::json!({}));
        Ok(())
    }

    pub fn move_folder(&mut self, old_path: &str, new_path: &str) -> Result<(), AppError> {
        let old_full = self.worktree_dir()?.join(old_path);
        let new_full = self.worktree_dir()?.join(new_path);
        if !old_full.exists() {
            return Err(AppError::FolderNotFound {
                path: old_path.to_string(),
            });
        }
        std::fs::rename(&old_full, &new_full).map_err(|e| AppError::Internal {
            message: format!("failed to move folder: {e}"),
        })?;
        self.emitter.emit("tree:changed", serde_json::json!({}));
        Ok(())
    }

    pub fn list_tree(&self) -> Result<Vec<TreeNode>, AppError> {
        let worktree = self.worktree_dir()?;
        Self::build_tree(worktree, "")
    }

    fn build_tree(base: &Path, prefix: &str) -> Result<Vec<TreeNode>, AppError> {
        let dir = if prefix.is_empty() {
            base.to_path_buf()
        } else {
            base.join(prefix)
        };

        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut nodes = Vec::new();
        let mut entries: Vec<_> = std::fs::read_dir(&dir)
            .map_err(|e| AppError::Internal {
                message: format!("failed to read dir: {e}"),
            })?
            .filter_map(|e| e.ok())
            .collect();

        // Sort: folders first, then alphabetical
        entries.sort_by(|a, b| {
            let a_is_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let b_is_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
            match (a_is_dir, b_is_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.file_name().cmp(&b.file_name()),
            }
        });

        for entry in entries {
            let name = entry.file_name().to_string_lossy().to_string();
            // Skip hidden files
            if name.starts_with('.') {
                continue;
            }
            let path = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

            if is_dir {
                let children = Self::build_tree(base, &path)?;
                nodes.push(TreeNode {
                    name,
                    path,
                    kind: "folder".to_string(),
                    children: Some(children),
                });
            } else {
                nodes.push(TreeNode {
                    name,
                    path,
                    kind: "file".to_string(),
                    children: None,
                });
            }
        }

        Ok(nodes)
    }

    pub fn list_workspaces(&self) -> Result<Vec<WorkspaceMeta>, AppError> {
        let mut workspaces = Vec::new();
        if !self.base_dir.exists() {
            return Ok(workspaces);
        }
        for entry in std::fs::read_dir(&self.base_dir).map_err(|e| AppError::Internal {
            message: format!("failed to read base dir: {e}"),
        })? {
            let entry = entry.map_err(|e| AppError::Internal {
                message: format!("failed to read dir entry: {e}"),
            })?;
            let meta_path = entry.path().join("workspace.json");
            if meta_path.exists() {
                let meta_str = std::fs::read_to_string(&meta_path).map_err(|e| {
                    AppError::Internal {
                        message: format!("failed to read metadata: {e}"),
                    }
                })?;
                if let Ok(meta) = serde_json::from_str::<WorkspaceMeta>(&meta_str) {
                    workspaces.push(meta);
                }
            }
        }
        Ok(workspaces)
    }

    pub fn delete_workspace(&mut self, id: &str) -> Result<(), AppError> {
        let workspace_dir = self.base_dir.join(id);
        if !workspace_dir.exists() {
            return Err(AppError::Internal {
                message: format!("workspace not found: {id}"),
            });
        }
        // Close if this is the active workspace
        if let Some(meta) = &self.meta {
            if meta.id == id {
                self.repo = None;
                self.meta = None;
                self.worktree_path = None;
            }
        }
        std::fs::remove_dir_all(&workspace_dir).map_err(|e| AppError::Internal {
            message: format!("failed to delete workspace: {e}"),
        })?;
        Ok(())
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

    fn setup_with_workspace() -> (TempDir, WorkspaceService) {
        let tmp = TempDir::new().unwrap();
        let emitter = Arc::new(TestEmitter::new());
        let mut svc = WorkspaceService::new(tmp.path().to_path_buf(), emitter);
        let id = svc.create_workspace("Test").unwrap();
        svc.open_workspace(&id).unwrap();
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

    #[test]
    fn test_list_workspaces_empty() {
        let (_tmp, svc) = setup();
        let list = svc.list_workspaces().unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn test_list_workspaces_returns_created() {
        let (_tmp, mut svc) = setup();
        svc.create_workspace("Notes A").unwrap();
        svc.create_workspace("Notes B").unwrap();
        let list = svc.list_workspaces().unwrap();
        assert_eq!(list.len(), 2);
        let names: Vec<&str> = list.iter().map(|m| m.name.as_str()).collect();
        assert!(names.contains(&"Notes A"));
        assert!(names.contains(&"Notes B"));
    }

    #[test]
    fn test_delete_workspace_removes_dir() {
        let (tmp, mut svc) = setup();
        let id = svc.create_workspace("Temp").unwrap();
        assert!(tmp.path().join(&id).exists());
        svc.delete_workspace(&id).unwrap();
        assert!(!tmp.path().join(&id).exists());
    }

    #[test]
    fn test_delete_workspace_not_in_list() {
        let (_tmp, mut svc) = setup();
        let id = svc.create_workspace("Temp").unwrap();
        svc.delete_workspace(&id).unwrap();
        let list = svc.list_workspaces().unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn test_create_and_read_document() {
        let (_tmp, mut svc) = setup_with_workspace();
        svc.create_document("hello.md").unwrap();
        svc.write_document("hello.md", "# Hello World").unwrap();
        let content = svc.read_document("hello.md").unwrap();
        assert_eq!(content, "# Hello World");
    }

    #[test]
    fn test_read_nonexistent_document_errors() {
        let (_tmp, svc) = setup_with_workspace();
        let result = svc.read_document("nope.md");
        assert!(matches!(result, Err(AppError::DocumentNotFound { .. })));
    }

    #[test]
    fn test_create_document_in_subfolder() {
        let (_tmp, mut svc) = setup_with_workspace();
        svc.create_document("projects/notes/idea.md").unwrap();
        svc.write_document("projects/notes/idea.md", "content")
            .unwrap();
        let content = svc.read_document("projects/notes/idea.md").unwrap();
        assert_eq!(content, "content");
    }

    #[test]
    fn test_delete_document() {
        let (_tmp, mut svc) = setup_with_workspace();
        svc.create_document("temp.md").unwrap();
        svc.write_document("temp.md", "data").unwrap();
        svc.delete_document("temp.md").unwrap();
        let result = svc.read_document("temp.md");
        assert!(result.is_err());
    }

    #[test]
    fn test_move_document() {
        let (_tmp, mut svc) = setup_with_workspace();
        svc.create_document("old.md").unwrap();
        svc.write_document("old.md", "content").unwrap();
        svc.move_document("old.md", "new.md").unwrap();
        let result = svc.read_document("old.md");
        assert!(result.is_err());
        let content = svc.read_document("new.md").unwrap();
        assert_eq!(content, "content");
    }

    #[test]
    fn test_write_document_emits_event() {
        let (_tmp, mut svc) = setup_with_workspace();
        let emitter = svc.emitter.clone();
        let test_emitter = emitter.as_any().downcast_ref::<TestEmitter>().unwrap();
        svc.create_document("test.md").unwrap();
        svc.write_document("test.md", "content").unwrap();
        assert!(test_emitter.has_event("document:changed"));
    }

    #[test]
    fn test_create_folder_with_gitkeep() {
        let (_tmp, mut svc) = setup_with_workspace();
        svc.create_folder("projects/ideas").unwrap();
        let worktree = svc.worktree_dir().unwrap();
        assert!(worktree.join("projects/ideas/.gitkeep").exists());
    }

    #[test]
    fn test_delete_folder_recursive() {
        let (_tmp, mut svc) = setup_with_workspace();
        svc.create_folder("projects").unwrap();
        svc.create_document("projects/note.md").unwrap();
        svc.delete_folder("projects").unwrap();
        let result = svc.read_document("projects/note.md");
        assert!(result.is_err());
    }

    #[test]
    fn test_move_folder() {
        let (_tmp, mut svc) = setup_with_workspace();
        svc.create_folder("old-name").unwrap();
        svc.create_document("old-name/note.md").unwrap();
        svc.write_document("old-name/note.md", "data").unwrap();
        svc.move_folder("old-name", "new-name").unwrap();
        let content = svc.read_document("new-name/note.md").unwrap();
        assert_eq!(content, "data");
    }

    #[test]
    fn test_list_tree_empty() {
        let (_tmp, svc) = setup_with_workspace();
        let tree = svc.list_tree().unwrap();
        // build_tree filters dotfiles, so tree should be empty for a fresh workspace
        assert!(tree.is_empty());
    }

    #[test]
    fn test_list_tree_structure() {
        let (_tmp, mut svc) = setup_with_workspace();
        svc.create_folder("projects").unwrap();
        svc.create_document("projects/arch.md").unwrap();
        svc.create_document("inbox.md").unwrap();
        let tree = svc.list_tree().unwrap();

        // Should have at least "projects" folder and "inbox.md" file
        let names: Vec<&str> = tree.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"projects"));
        assert!(names.contains(&"inbox.md"));

        // projects should have arch.md as child
        let projects = tree.iter().find(|n| n.name == "projects").unwrap();
        assert_eq!(projects.kind, "folder");
        let child_names: Vec<&str> = projects
            .children
            .as_ref()
            .unwrap()
            .iter()
            .map(|n| n.name.as_str())
            .collect();
        assert!(child_names.contains(&"arch.md"));
    }
}
