use crate::error::AppError;
use crate::events::EventEmitter;
use git2::{Repository, Signature};
use serde::Serialize;
use std::path::Path;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    pub oid: String,
    pub message: String,
    pub time: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub head_oid: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileStatus {
    pub path: String,
    pub status: String, // "new", "modified", "deleted"
}

#[derive(Debug, Clone, Serialize)]
pub enum MergeResult {
    Clean,
    Conflict { paths: Vec<String> },
}

pub struct VcsService {
    emitter: Arc<dyn EventEmitter>,
}

impl VcsService {
    pub fn new(emitter: Arc<dyn EventEmitter>) -> Self {
        Self { emitter }
    }

    pub fn commit(
        &self,
        repo: &Repository,
        _worktree_path: &Path,
        message: &str,
    ) -> Result<String, AppError> {
        let mut index = repo.index()?;
        index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
        index.write()?;

        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let sig = repo
            .signature()
            .or_else(|_| Signature::now("Emergent", "emergent@local"))?;

        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();

        let oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)?;
        let oid_str = oid.to_string();

        self.emitter.emit(
            "commit:created",
            serde_json::json!({"oid": oid_str, "message": message}),
        );

        Ok(oid_str)
    }

    pub fn get_log(&self, repo: &Repository, limit: usize) -> Result<Vec<CommitInfo>, AppError> {
        let mut revwalk = repo.revwalk()?;
        revwalk.push_head()?;
        revwalk.set_sorting(git2::Sort::TIME)?;

        let mut commits = Vec::new();
        for oid in revwalk.take(limit) {
            let oid = oid?;
            let commit = repo.find_commit(oid)?;
            commits.push(CommitInfo {
                oid: oid.to_string(),
                message: commit.message().unwrap_or("").to_string(),
                time: commit.time().seconds(),
            });
        }
        Ok(commits)
    }

    pub fn get_status(&self, repo: &Repository) -> Result<Vec<FileStatus>, AppError> {
        let statuses = repo.statuses(None)?;
        let mut result = Vec::new();
        for entry in statuses.iter() {
            let path = entry.path().unwrap_or("").to_string();
            let status = entry.status();
            let kind = if status.contains(git2::Status::WT_NEW)
                || status.contains(git2::Status::INDEX_NEW)
            {
                "new"
            } else if status.contains(git2::Status::WT_MODIFIED)
                || status.contains(git2::Status::INDEX_MODIFIED)
            {
                "modified"
            } else if status.contains(git2::Status::WT_DELETED)
                || status.contains(git2::Status::INDEX_DELETED)
            {
                "deleted"
            } else {
                "unknown"
            };
            result.push(FileStatus {
                path,
                status: kind.to_string(),
            });
        }
        Ok(result)
    }

    pub fn create_branch(&self, repo: &Repository, name: &str) -> Result<(), AppError> {
        let head = repo.head()?.peel_to_commit()?;
        if repo.find_branch(name, git2::BranchType::Local).is_ok() {
            return Err(AppError::BranchAlreadyExists {
                name: name.to_string(),
            });
        }
        repo.branch(name, &head, false)?;
        Ok(())
    }

    pub fn list_branches(&self, repo: &Repository) -> Result<Vec<BranchInfo>, AppError> {
        let mut branches = Vec::new();
        for branch in repo.branches(Some(git2::BranchType::Local))? {
            let (branch, _) = branch?;
            let name = branch.name()?.unwrap_or("").to_string();
            let oid = branch.get().peel_to_commit()?.id().to_string();
            branches.push(BranchInfo {
                name,
                head_oid: oid,
            });
        }
        Ok(branches)
    }

    pub fn delete_branch(&self, repo: &Repository, name: &str) -> Result<(), AppError> {
        let mut branch = repo.find_branch(name, git2::BranchType::Local)?;
        branch.delete()?;
        Ok(())
    }

    /// Merges `source_branch` into the currently checked-out branch.
    pub fn merge_branch(
        &self,
        repo: &Repository,
        _worktree_path: &Path,
        source_branch: &str,
    ) -> Result<MergeResult, AppError> {
        let source = repo
            .find_branch(source_branch, git2::BranchType::Local)?
            .get()
            .peel_to_commit()?
            .id();
        let annotated = repo.find_annotated_commit(source)?;
        let (analysis, _) = repo.merge_analysis(&[&annotated])?;

        if analysis.is_up_to_date() {
            return Ok(MergeResult::Clean);
        }

        if analysis.is_fast_forward() {
            // Fast-forward
            let mut reference = repo.head()?;
            reference
                .set_target(source, &format!("fast-forward merge {source_branch}"))?;
            repo.checkout_head(Some(
                git2::build::CheckoutBuilder::new().force(),
            ))?;
            self.emitter.emit("tree:changed", serde_json::json!({}));
            return Ok(MergeResult::Clean);
        }

        // Normal merge
        repo.merge(&[&annotated], None, None)?;
        let index = repo.index()?;

        if index.has_conflicts() {
            let mut conflicts = Vec::new();
            for conflict in index.conflicts()? {
                let conflict = conflict?;
                let path = conflict
                    .our
                    .as_ref()
                    .or(conflict.ancestor.as_ref())
                    .map(|e| String::from_utf8_lossy(&e.path).to_string())
                    .unwrap_or_default();

                // Read ours/theirs content from the blobs
                let ours_content = conflict
                    .our
                    .as_ref()
                    .and_then(|e| repo.find_blob(e.id).ok())
                    .map(|b| String::from_utf8_lossy(b.content()).to_string())
                    .unwrap_or_default();
                let theirs_content = conflict
                    .their
                    .as_ref()
                    .and_then(|e| repo.find_blob(e.id).ok())
                    .map(|b| String::from_utf8_lossy(b.content()).to_string())
                    .unwrap_or_default();

                conflicts.push(serde_json::json!({
                    "path": path,
                    "ours": ours_content,
                    "theirs": theirs_content,
                }));
            }
            let conflict_paths: Vec<String> = conflicts
                .iter()
                .map(|c| c["path"].as_str().unwrap_or("").to_string())
                .collect();
            self.emitter.emit(
                "merge:conflict",
                serde_json::json!({"conflicts": conflicts}),
            );
            return Ok(MergeResult::Conflict {
                paths: conflict_paths,
            });
        }

        // No conflicts — commit the merge
        let mut index = repo.index()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let sig = repo
            .signature()
            .or_else(|_| Signature::now("Emergent", "emergent@local"))?;
        let head_commit = repo.head()?.peel_to_commit()?;
        let source_commit = repo.find_commit(source)?;
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            &format!("Merge branch '{source_branch}'"),
            &tree,
            &[&head_commit, &source_commit],
        )?;
        repo.cleanup_state()?;
        self.emitter.emit("tree:changed", serde_json::json!({}));
        Ok(MergeResult::Clean)
    }
}

// Note on API design: VcsService methods take &Repository and &Path as parameters
// rather than holding state internally. This is because the active repo lives in
// WorkspaceService. The Tauri command layer extracts the repo/worktree from
// WorkspaceService and passes them to VcsService. This keeps VcsService stateless
// and testable without needing a WorkspaceService.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::TestEmitter;
    use tempfile::TempDir;

    fn setup() -> (TempDir, VcsService, Repository) {
        let tmp = TempDir::new().unwrap();
        let emitter = Arc::new(TestEmitter::new());
        let svc = VcsService::new(emitter);
        let repo = Repository::init(tmp.path()).unwrap();

        // Configure git user for commits
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        (tmp, svc, repo)
    }

    fn create_file(dir: &Path, name: &str, content: &str) {
        std::fs::write(dir.join(name), content).unwrap();
    }

    #[test]
    fn test_commit_stages_and_commits() {
        let (tmp, svc, repo) = setup();
        create_file(tmp.path(), "note.md", "# Hello");
        let oid = svc.commit(&repo, tmp.path(), "initial commit").unwrap();
        assert!(!oid.is_empty());
    }

    #[test]
    fn test_get_log_returns_commits() {
        let (tmp, svc, repo) = setup();
        create_file(tmp.path(), "note.md", "# Hello");
        svc.commit(&repo, tmp.path(), "first").unwrap();
        create_file(tmp.path(), "note.md", "# Updated");
        svc.commit(&repo, tmp.path(), "second").unwrap();
        let log = svc.get_log(&repo, 10).unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].message, "second");
        assert_eq!(log[1].message, "first");
    }

    #[test]
    fn test_get_log_respects_limit() {
        let (tmp, svc, repo) = setup();
        for i in 0..5 {
            create_file(tmp.path(), "note.md", &format!("v{i}"));
            svc.commit(&repo, tmp.path(), &format!("commit {i}"))
                .unwrap();
        }
        let log = svc.get_log(&repo, 3).unwrap();
        assert_eq!(log.len(), 3);
    }

    #[test]
    fn test_commit_emits_event() {
        let (tmp, svc, repo) = setup();
        let emitter = svc.emitter.clone();
        let test_emitter = emitter.as_any().downcast_ref::<TestEmitter>().unwrap();
        create_file(tmp.path(), "note.md", "content");
        svc.commit(&repo, tmp.path(), "msg").unwrap();
        assert!(test_emitter.has_event("commit:created"));
    }

    #[test]
    fn test_get_status_shows_changes() {
        let (tmp, svc, repo) = setup();
        create_file(tmp.path(), "note.md", "content");
        svc.commit(&repo, tmp.path(), "initial").unwrap();
        create_file(tmp.path(), "note.md", "changed");
        create_file(tmp.path(), "new.md", "new file");
        let status = svc.get_status(&repo).unwrap();
        assert!(status.len() >= 2);
    }

    #[test]
    fn test_create_and_list_branches() {
        let (tmp, svc, repo) = setup();
        create_file(tmp.path(), "note.md", "content");
        svc.commit(&repo, tmp.path(), "initial").unwrap();
        svc.create_branch(&repo, "feature").unwrap();
        let branches = svc.list_branches(&repo).unwrap();
        let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
        assert!(names.contains(&"main") || names.contains(&"master"));
        assert!(names.contains(&"feature"));
    }

    #[test]
    fn test_create_duplicate_branch_errors() {
        let (tmp, svc, repo) = setup();
        create_file(tmp.path(), "note.md", "content");
        svc.commit(&repo, tmp.path(), "initial").unwrap();
        svc.create_branch(&repo, "feature").unwrap();
        let result = svc.create_branch(&repo, "feature");
        assert!(matches!(result, Err(AppError::BranchAlreadyExists { .. })));
    }

    /// Returns the name of the current HEAD branch (e.g., "main" or "master").
    fn head_branch_name(repo: &Repository) -> String {
        let head = repo.head().unwrap();
        head.shorthand().unwrap().to_string()
    }

    #[test]
    fn test_merge_clean() {
        let (tmp, svc, repo) = setup();
        // Create initial commit on default branch
        create_file(tmp.path(), "note.md", "original");
        svc.commit(&repo, tmp.path(), "initial").unwrap();

        let default_branch = head_branch_name(&repo);

        // Create feature branch and add a file
        svc.create_branch(&repo, "feature").unwrap();
        repo.set_head("refs/heads/feature").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
        create_file(tmp.path(), "new.md", "new content");
        svc.commit(&repo, tmp.path(), "add new file").unwrap();

        // Switch back to default branch
        repo.set_head(&format!("refs/heads/{default_branch}"))
            .unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();

        // Merge feature into current branch
        let result = svc
            .merge_branch(&repo, tmp.path(), "feature")
            .unwrap();
        assert!(matches!(result, MergeResult::Clean));
    }

    #[test]
    fn test_merge_conflict() {
        let (tmp, svc, repo) = setup();
        // Create initial commit on default branch
        create_file(tmp.path(), "note.md", "original content");
        svc.commit(&repo, tmp.path(), "initial").unwrap();

        let default_branch = head_branch_name(&repo);

        // Create feature branch and modify the same file
        svc.create_branch(&repo, "feature").unwrap();
        repo.set_head("refs/heads/feature").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
        create_file(tmp.path(), "note.md", "feature changes");
        svc.commit(&repo, tmp.path(), "feature change").unwrap();

        // Switch back to default branch and make a conflicting change
        repo.set_head(&format!("refs/heads/{default_branch}"))
            .unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
        create_file(tmp.path(), "note.md", "main changes");
        svc.commit(&repo, tmp.path(), "main change").unwrap();

        // Merge feature into default branch — should conflict
        let result = svc
            .merge_branch(&repo, tmp.path(), "feature")
            .unwrap();
        assert!(
            matches!(result, MergeResult::Conflict { paths } if !paths.is_empty())
        );
    }

    #[test]
    fn test_delete_branch() {
        let (tmp, svc, repo) = setup();
        create_file(tmp.path(), "note.md", "content");
        svc.commit(&repo, tmp.path(), "initial").unwrap();
        svc.create_branch(&repo, "temp").unwrap();
        svc.delete_branch(&repo, "temp").unwrap();
        let branches = svc.list_branches(&repo).unwrap();
        let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
        assert!(!names.contains(&"temp"));
    }
}
