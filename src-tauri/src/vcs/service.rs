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
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize)]
pub enum MergeResult {
    Clean,
    Conflict { paths: Vec<String> },
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffLine {
    pub kind: String,
    pub content: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffHunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffResult {
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HeadInfo {
    pub oid: String,
    pub message: String,
    pub time: i64,
    pub is_detached: bool,
    pub branch_name: Option<String>,
    pub commits_behind: usize,
    pub commits_ahead: usize,
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
        branch_name: Option<&str>,
    ) -> Result<String, AppError> {
        // If branch_name provided and HEAD is detached, fork into a new branch
        if let Some(name) = branch_name {
            if repo.head_detached().unwrap_or(false) {
                if repo.find_branch(name, git2::BranchType::Local).is_ok() {
                    return Err(AppError::BranchAlreadyExists {
                        name: name.to_string(),
                    });
                }

                let mut index = repo.index()?;
                index.write()?;
                let tree_oid = index.write_tree()?;
                let tree = repo.find_tree(tree_oid)?;
                let sig = repo
                    .signature()
                    .or_else(|_| Signature::now("Emergent", "emergent@local"))?;
                let parent = repo.head()?.peel_to_commit()?;
                let oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])?;

                let new_commit = repo.find_commit(oid)?;
                repo.branch(name, &new_commit, false)?;
                repo.set_head(&format!("refs/heads/{name}"))?;

                let oid_str = oid.to_string();
                self.emitter.emit(
                    "commit:created",
                    serde_json::json!({"oid": oid_str, "message": message}),
                );
                self.emitter
                    .emit("vcs:status-changed", serde_json::json!({}));

                return Ok(oid_str);
            }
        }

        let mut index = repo.index()?;
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
        self.emitter
            .emit("vcs:status-changed", serde_json::json!({}));

        Ok(oid_str)
    }

    pub fn checkout_commit(
        &self,
        repo: &Repository,
        _worktree_path: &Path,
        oid: &str,
    ) -> Result<CommitInfo, AppError> {
        let oid = git2::Oid::from_str(oid).map_err(|e| AppError::GitError {
            message: format!("invalid OID: {e}"),
        })?;
        let commit = repo.find_commit(oid)?;

        repo.set_head_detached(oid)?;
        repo.checkout_head(Some(
            git2::build::CheckoutBuilder::new().force(),
        ))?;

        self.emitter.emit("tree:changed", serde_json::json!({}));

        Ok(CommitInfo {
            oid: oid.to_string(),
            message: commit.message().unwrap_or("").to_string(),
            time: commit.time().seconds(),
        })
    }

    pub fn get_head_info(
        &self,
        repo: &Repository,
        origin_branch: Option<&str>,
    ) -> Result<HeadInfo, AppError> {
        let head = repo.head()?;
        let is_detached = repo.head_detached()?;
        let commit = head.peel_to_commit()?;
        let oid = commit.id();

        let branch_name = if is_detached {
            None
        } else {
            head.shorthand().map(|s| s.to_string())
        };

        let (commits_ahead, commits_behind) = if let Some(origin) = origin_branch {
            let origin_ref = format!("refs/heads/{origin}");
            if let Ok(reference) = repo.find_reference(&origin_ref) {
                let origin_oid = reference.peel_to_commit()?.id();
                repo.graph_ahead_behind(oid, origin_oid)?
            } else {
                (0, 0)
            }
        } else {
            (0, 0)
        };

        Ok(HeadInfo {
            oid: oid.to_string(),
            message: commit.message().unwrap_or("").to_string(),
            time: commit.time().seconds(),
            is_detached,
            branch_name,
            commits_behind,
            commits_ahead,
        })
    }

    pub fn stage(
        &self,
        repo: &Repository,
        worktree_path: &Path,
        paths: &[String],
    ) -> Result<(), AppError> {
        let mut index = repo.index()?;
        for path in paths {
            let abs = worktree_path.join(path);
            if abs.exists() {
                index.add_path(Path::new(path))?;
            } else {
                // File was deleted — remove from index
                index.remove_path(Path::new(path))?;
            }
        }
        index.write()?;
        self.emitter
            .emit("vcs:status-changed", serde_json::json!({}));
        Ok(())
    }

    pub fn unstage(
        &self,
        repo: &Repository,
        _worktree_path: &Path,
        paths: &[String],
    ) -> Result<(), AppError> {
        let mut index = repo.index()?;
        let head_tree = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .and_then(|c| c.tree().ok());

        for path in paths {
            let p = Path::new(path);
            let in_head = head_tree
                .as_ref()
                .and_then(|t| t.get_path(p).ok())
                .is_some();

            if in_head {
                // Reset index entry to the HEAD version
                let tree = head_tree.as_ref().unwrap();
                let entry = tree.get_path(p).unwrap();
                let blob_oid = entry.id();
                let blob = repo.find_blob(blob_oid)?;
                let mut index_entry = git2::IndexEntry {
                    ctime: git2::IndexTime::new(0, 0),
                    mtime: git2::IndexTime::new(0, 0),
                    dev: 0,
                    ino: 0,
                    mode: entry.filemode() as u32,
                    uid: 0,
                    gid: 0,
                    file_size: blob.content().len() as u32,
                    id: blob_oid,
                    flags: 0,
                    flags_extended: 0,
                    path: path.as_bytes().to_vec(),
                };
                // Ensure the flags encode the path length correctly
                index_entry.flags = (path.len() as u16).min(0x0fff);
                index.add(&index_entry)?;
            } else {
                // Not in HEAD → just remove from index
                index.remove_path(p)?;
            }
        }
        index.write()?;
        self.emitter
            .emit("vcs:status-changed", serde_json::json!({}));
        Ok(())
    }

    pub fn diff(
        &self,
        repo: &Repository,
        worktree_path: &Path,
        file_path: &str,
    ) -> Result<DiffResult, AppError> {
        let head_tree = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .and_then(|c| c.tree().ok());

        // Check if file is untracked (not in HEAD and not in index)
        let in_head = head_tree
            .as_ref()
            .and_then(|t| t.get_path(Path::new(file_path)).ok())
            .is_some();
        let _in_index = repo
            .index()
            .ok()
            .and_then(|idx| idx.get_path(Path::new(file_path), 0))
            .is_some();

        if !in_head {
            // New file (untracked or staged but not yet committed)
            // Build synthetic diff showing all lines as additions
            let full_path = worktree_path.join(file_path);
            if let Ok(content) = std::fs::read_to_string(&full_path) {
                let lines: Vec<DiffLine> = content
                    .lines()
                    .enumerate()
                    .map(|(i, line)| DiffLine {
                        kind: "add".to_string(),
                        content: format!("{line}\n"),
                        old_lineno: None,
                        new_lineno: Some((i + 1) as u32),
                    })
                    .collect();
                let line_count = lines.len();
                return Ok(DiffResult {
                    hunks: vec![DiffHunk {
                        header: format!("@@ -0,0 +1,{line_count} @@"),
                        lines,
                    }],
                });
            }
            return Ok(DiffResult { hunks: vec![] });
        }

        let mut opts = git2::DiffOptions::new();
        opts.pathspec(file_path);

        let diff = repo.diff_tree_to_workdir(head_tree.as_ref(), Some(&mut opts))?;

        let mut hunks: Vec<DiffHunk> = Vec::new();

        diff.print(git2::DiffFormat::Patch, |_delta, hunk, line| {
            if let Some(hunk_header) = hunk {
                let header = String::from_utf8_lossy(hunk_header.header()).trim().to_string();
                if hunks.last().map_or(true, |h: &DiffHunk| h.header != header) {
                    hunks.push(DiffHunk {
                        header,
                        lines: Vec::new(),
                    });
                }
            }

            let kind = match line.origin() {
                '+' => "add",
                '-' => "remove",
                ' ' => "context",
                _ => return true,
            };
            let content = String::from_utf8_lossy(line.content()).to_string();
            if let Some(current_hunk) = hunks.last_mut() {
                current_hunk.lines.push(DiffLine {
                    kind: kind.to_string(),
                    content,
                    old_lineno: line.old_lineno(),
                    new_lineno: line.new_lineno(),
                });
            }
            true
        })?;

        Ok(DiffResult { hunks })
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

            // Check staged (INDEX_*) flags
            let staged_kind = if status.contains(git2::Status::INDEX_NEW) {
                Some("new")
            } else if status.contains(git2::Status::INDEX_MODIFIED) {
                Some("modified")
            } else if status.contains(git2::Status::INDEX_DELETED) {
                Some("deleted")
            } else {
                None
            };

            if let Some(kind) = staged_kind {
                result.push(FileStatus {
                    path: path.clone(),
                    status: kind.to_string(),
                    staged: true,
                });
            }

            // Check unstaged (WT_*) flags
            let unstaged_kind = if status.contains(git2::Status::WT_NEW) {
                Some("new")
            } else if status.contains(git2::Status::WT_MODIFIED) {
                Some("modified")
            } else if status.contains(git2::Status::WT_DELETED) {
                Some("deleted")
            } else {
                None
            };

            if let Some(kind) = unstaged_kind {
                result.push(FileStatus {
                    path: path.clone(),
                    status: kind.to_string(),
                    staged: false,
                });
            }
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

    fn setup() -> (TempDir, Arc<dyn EventEmitter>, VcsService, Repository) {
        let tmp = TempDir::new().unwrap();
        let emitter: Arc<dyn EventEmitter> = Arc::new(TestEmitter::new());
        let svc = VcsService::new(emitter.clone());
        let repo = Repository::init(tmp.path()).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();
        (tmp, emitter, svc, repo)
    }

    fn create_file(dir: &Path, name: &str, content: &str) {
        std::fs::write(dir.join(name), content).unwrap();
    }

    #[test]
    fn test_commit_stages_and_commits() {
        let (tmp, _emitter, svc, repo) = setup();
        create_file(tmp.path(), "note.md", "# Hello");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()])
            .unwrap();
        let oid = svc.commit(&repo, tmp.path(), "initial commit", None).unwrap();
        assert!(!oid.is_empty());
    }

    #[test]
    fn test_get_log_returns_commits() {
        let (tmp, _emitter, svc, repo) = setup();
        create_file(tmp.path(), "note.md", "# Hello");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "first", None).unwrap();
        create_file(tmp.path(), "note.md", "# Updated");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "second", None).unwrap();
        let log = svc.get_log(&repo, 10).unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].message, "second");
        assert_eq!(log[1].message, "first");
    }

    #[test]
    fn test_get_log_respects_limit() {
        let (tmp, _emitter, svc, repo) = setup();
        for i in 0..5 {
            create_file(tmp.path(), "note.md", &format!("v{i}"));
            svc.stage(&repo, tmp.path(), &["note.md".to_string()])
                .unwrap();
            svc.commit(&repo, tmp.path(), &format!("commit {i}"), None)
                .unwrap();
        }
        let log = svc.get_log(&repo, 3).unwrap();
        assert_eq!(log.len(), 3);
    }

    #[test]
    fn test_commit_emits_event() {
        let (tmp, _emitter, svc, repo) = setup();
        let test_emitter = svc
            .emitter
            .as_any()
            .downcast_ref::<TestEmitter>()
            .unwrap();
        create_file(tmp.path(), "note.md", "content");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "msg", None).unwrap();
        assert!(test_emitter.has_event("commit:created"));
    }

    #[test]
    fn test_get_status_shows_changes() {
        let (tmp, _emitter, svc, repo) = setup();
        create_file(tmp.path(), "note.md", "content");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "initial", None).unwrap();
        create_file(tmp.path(), "note.md", "changed");
        create_file(tmp.path(), "new.md", "new file");
        let status = svc.get_status(&repo).unwrap();
        assert!(status.len() >= 2);
    }

    #[test]
    fn test_create_and_list_branches() {
        let (tmp, _emitter, svc, repo) = setup();
        create_file(tmp.path(), "note.md", "content");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "initial", None).unwrap();
        svc.create_branch(&repo, "feature").unwrap();
        let branches = svc.list_branches(&repo).unwrap();
        let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
        assert!(names.contains(&"main") || names.contains(&"master"));
        assert!(names.contains(&"feature"));
    }

    #[test]
    fn test_create_duplicate_branch_errors() {
        let (tmp, _emitter, svc, repo) = setup();
        create_file(tmp.path(), "note.md", "content");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "initial", None).unwrap();
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
        let (tmp, _emitter, svc, repo) = setup();
        // Create initial commit on default branch
        create_file(tmp.path(), "note.md", "original");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "initial", None).unwrap();

        let default_branch = head_branch_name(&repo);

        // Create feature branch and add a file
        svc.create_branch(&repo, "feature").unwrap();
        repo.set_head("refs/heads/feature").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
        create_file(tmp.path(), "new.md", "new content");
        svc.stage(&repo, tmp.path(), &["new.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "add new file", None).unwrap();

        // Switch back to default branch
        repo.set_head(&format!("refs/heads/{default_branch}"))
            .unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();

        // Merge feature into current branch
        let result = svc.merge_branch(&repo, tmp.path(), "feature").unwrap();
        assert!(matches!(result, MergeResult::Clean));
    }

    #[test]
    fn test_merge_conflict() {
        let (tmp, _emitter, svc, repo) = setup();
        // Create initial commit on default branch
        create_file(tmp.path(), "note.md", "original content");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "initial", None).unwrap();

        let default_branch = head_branch_name(&repo);

        // Create feature branch and modify the same file
        svc.create_branch(&repo, "feature").unwrap();
        repo.set_head("refs/heads/feature").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
        create_file(tmp.path(), "note.md", "feature changes");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "feature change", None).unwrap();

        // Switch back to default branch and make a conflicting change
        repo.set_head(&format!("refs/heads/{default_branch}"))
            .unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
        create_file(tmp.path(), "note.md", "main changes");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "main change", None).unwrap();

        // Merge feature into default branch — should conflict
        let result = svc.merge_branch(&repo, tmp.path(), "feature").unwrap();
        assert!(
            matches!(result, MergeResult::Conflict { paths } if !paths.is_empty())
        );
    }

    #[test]
    fn test_delete_branch() {
        let (tmp, _emitter, svc, repo) = setup();
        create_file(tmp.path(), "note.md", "content");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "initial", None).unwrap();
        svc.create_branch(&repo, "temp").unwrap();
        svc.delete_branch(&repo, "temp").unwrap();
        let branches = svc.list_branches(&repo).unwrap();
        let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
        assert!(!names.contains(&"temp"));
    }

    // ── Task 1 tests ─────────────────────────────────────────────────────────

    #[test]
    fn test_get_status_distinguishes_staged_and_unstaged() {
        let (tmp, _emitter, svc, repo) = setup();

        // Initial commit so HEAD exists
        create_file(tmp.path(), "existing.md", "original");
        svc.stage(&repo, tmp.path(), &["existing.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "initial", None).unwrap();

        // Stage a new file
        create_file(tmp.path(), "staged.md", "staged content");
        svc.stage(&repo, tmp.path(), &["staged.md".to_string()])
            .unwrap();

        // Modify existing.md without staging
        create_file(tmp.path(), "existing.md", "modified but not staged");

        // Create an untracked file
        create_file(tmp.path(), "untracked.md", "untracked");

        let status = svc.get_status(&repo).unwrap();

        let staged_entries: Vec<_> = status.iter().filter(|e| e.staged).collect();
        let unstaged_entries: Vec<_> = status.iter().filter(|e| !e.staged).collect();

        // staged.md should appear as staged new
        assert!(
            staged_entries
                .iter()
                .any(|e| e.path == "staged.md" && e.status == "new"),
            "staged.md should be staged new"
        );

        // existing.md modification should appear as unstaged modified
        assert!(
            unstaged_entries
                .iter()
                .any(|e| e.path == "existing.md" && e.status == "modified"),
            "existing.md should be unstaged modified"
        );

        // untracked.md should appear as unstaged new
        assert!(
            unstaged_entries
                .iter()
                .any(|e| e.path == "untracked.md" && e.status == "new"),
            "untracked.md should be unstaged new"
        );
    }

    // ── Task 2 tests ─────────────────────────────────────────────────────────

    #[test]
    fn test_stage_adds_files_to_index() {
        let (tmp, _emitter, svc, repo) = setup();
        create_file(tmp.path(), "file.md", "hello");
        svc.stage(&repo, tmp.path(), &["file.md".to_string()])
            .unwrap();

        let status = svc.get_status(&repo).unwrap();
        let staged: Vec<_> = status
            .iter()
            .filter(|e| e.staged && e.path == "file.md")
            .collect();
        assert!(!staged.is_empty(), "file.md should appear as staged");
    }

    #[test]
    fn test_unstage_removes_files_from_index() {
        let (tmp, _emitter, svc, repo) = setup();

        // Need an initial commit so HEAD exists for the no-HEAD branch in unstage
        create_file(tmp.path(), "other.md", "seed");
        svc.stage(&repo, tmp.path(), &["other.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "seed commit", None).unwrap();

        // Stage a new file then unstage it
        create_file(tmp.path(), "file.md", "hello");
        svc.stage(&repo, tmp.path(), &["file.md".to_string()])
            .unwrap();

        let before = svc.get_status(&repo).unwrap();
        assert!(
            before
                .iter()
                .any(|e| e.staged && e.path == "file.md"),
            "file.md should be staged before unstage"
        );

        svc.unstage(&repo, tmp.path(), &["file.md".to_string()])
            .unwrap();

        let after = svc.get_status(&repo).unwrap();
        assert!(
            !after.iter().any(|e| e.staged && e.path == "file.md"),
            "file.md should NOT be staged after unstage"
        );
        // It should still appear as an untracked/unstaged file
        assert!(
            after
                .iter()
                .any(|e| !e.staged && e.path == "file.md"),
            "file.md should still show as unstaged after unstage"
        );
    }

    #[test]
    fn test_stage_emits_status_changed_event() {
        let (tmp, _emitter, svc, repo) = setup();
        let test_emitter = svc
            .emitter
            .as_any()
            .downcast_ref::<TestEmitter>()
            .unwrap();
        create_file(tmp.path(), "file.md", "hello");
        svc.stage(&repo, tmp.path(), &["file.md".to_string()])
            .unwrap();
        assert!(
            test_emitter.has_event("vcs:status-changed"),
            "stage() should emit vcs:status-changed"
        );
    }

    // ── Task 3 tests ─────────────────────────────────────────────────────────

    #[test]
    fn test_diff_shows_modified_file_changes() {
        let (tmp, _emitter, svc, repo) = setup();

        // Initial commit
        create_file(tmp.path(), "note.md", "line one\nline two\n");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "initial", None).unwrap();

        // Modify the file (don't stage yet — diff shows workdir vs HEAD)
        create_file(tmp.path(), "note.md", "line one\nline two modified\n");

        let result = svc.diff(&repo, tmp.path(), "note.md").unwrap();

        assert!(!result.hunks.is_empty(), "diff should have at least one hunk");
        let all_lines: Vec<_> = result.hunks.iter().flat_map(|h| h.lines.iter()).collect();
        assert!(
            all_lines.iter().any(|l| l.kind == "add"),
            "diff should contain addition lines"
        );
        assert!(
            all_lines.iter().any(|l| l.kind == "remove"),
            "diff should contain deletion lines"
        );
    }

    #[test]
    fn test_diff_shows_new_file_as_all_additions() {
        let (tmp, _emitter, svc, repo) = setup();

        // Create and stage a new file (no HEAD commit yet).
        // diff_tree_to_workdir_with_index picks up staged new files vs no tree.
        create_file(tmp.path(), "new.md", "brand new\ncontent here\n");
        svc.stage(&repo, tmp.path(), &["new.md".to_string()])
            .unwrap();

        let result = svc.diff(&repo, tmp.path(), "new.md").unwrap();

        assert!(!result.hunks.is_empty(), "new file diff should have hunks");
        let all_lines: Vec<_> = result.hunks.iter().flat_map(|h| h.lines.iter()).collect();
        assert!(
            all_lines.iter().all(|l| l.kind == "add"),
            "new file diff lines should all be additions"
        );
        assert!(
            all_lines.iter().any(|l| l.kind == "add"),
            "new file diff should have at least one addition line"
        );
    }

    // ── Task 4 tests ─────────────────────────────────────────────────────────

    #[test]
    fn test_commit_only_commits_staged_files() {
        let (tmp, _emitter, svc, repo) = setup();

        // Create two files but only stage one
        create_file(tmp.path(), "staged.md", "will be committed");
        create_file(tmp.path(), "unstaged.md", "should remain uncommitted");

        svc.stage(&repo, tmp.path(), &["staged.md".to_string()])
            .unwrap();
        svc.commit(&repo, tmp.path(), "only staged file", None).unwrap();

        // After commit, unstaged.md should still appear as changed (untracked)
        let status = svc.get_status(&repo).unwrap();
        assert!(
            status
                .iter()
                .any(|e| e.path == "unstaged.md" && !e.staged),
            "unstaged.md should still show as changed after commit"
        );
        // staged.md should no longer appear in status (it's clean)
        assert!(
            !status.iter().any(|e| e.path == "staged.md"),
            "staged.md should be clean after commit"
        );
    }

    // ── checkout_commit tests ───────────────────────────────────────────────

    #[test]
    fn test_checkout_commit_detaches_head() {
        let (tmp, _emitter, svc, repo) = setup();

        // Create two commits
        create_file(tmp.path(), "note.md", "v1");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()]).unwrap();
        svc.commit(&repo, tmp.path(), "first", None).unwrap();

        create_file(tmp.path(), "note.md", "v2");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()]).unwrap();
        svc.commit(&repo, tmp.path(), "second", None).unwrap();

        // Get the first commit OID
        let log = svc.get_log(&repo, 10).unwrap();
        let first_oid = &log[1].oid; // second commit is index 0 (newest first)

        // Checkout the first commit
        let result = svc.checkout_commit(&repo, tmp.path(), first_oid).unwrap();
        assert_eq!(result.oid, *first_oid);
        assert_eq!(result.message, "first");

        // HEAD should be detached
        assert!(repo.head_detached().unwrap());

        // Working directory should reflect the first commit
        let content = std::fs::read_to_string(tmp.path().join("note.md")).unwrap();
        assert_eq!(content, "v1");
    }

    // ── get_head_info tests ────────────────────────────────────────────────

    #[test]
    fn test_get_head_info_on_branch() {
        let (tmp, _emitter, svc, repo) = setup();
        create_file(tmp.path(), "note.md", "v1");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()]).unwrap();
        svc.commit(&repo, tmp.path(), "initial", None).unwrap();

        let info = svc.get_head_info(&repo, None).unwrap();
        assert!(!info.is_detached);
        assert!(info.branch_name.is_some());
        assert_eq!(info.commits_behind, 0);
        assert_eq!(info.commits_ahead, 0);
    }

    #[test]
    fn test_get_head_info_detached_behind() {
        let (tmp, _emitter, svc, repo) = setup();

        create_file(tmp.path(), "note.md", "v1");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()]).unwrap();
        svc.commit(&repo, tmp.path(), "first", None).unwrap();

        create_file(tmp.path(), "note.md", "v2");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()]).unwrap();
        svc.commit(&repo, tmp.path(), "second", None).unwrap();

        create_file(tmp.path(), "note.md", "v3");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()]).unwrap();
        svc.commit(&repo, tmp.path(), "third", None).unwrap();

        // Find the "first" commit by message (log order may vary for same-second commits)
        let log = svc.get_log(&repo, 10).unwrap();
        let first_oid = log.iter().find(|c| c.message == "first").unwrap().oid.clone();
        svc.checkout_commit(&repo, tmp.path(), &first_oid).unwrap();

        let branches = svc.list_branches(&repo).unwrap();
        let default_branch = &branches[0].name;

        let info = svc.get_head_info(&repo, Some(default_branch)).unwrap();
        assert!(info.is_detached);
        assert!(info.branch_name.is_none());
        assert_eq!(info.commits_behind, 2);
        assert_eq!(info.commits_ahead, 0);
    }

    #[test]
    fn test_get_head_info_ahead_of_origin() {
        let (tmp, _emitter, svc, repo) = setup();

        create_file(tmp.path(), "note.md", "v1");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()]).unwrap();
        svc.commit(&repo, tmp.path(), "first", None).unwrap();

        let default_branch = head_branch_name(&repo);

        let log = svc.get_log(&repo, 10).unwrap();
        svc.checkout_commit(&repo, tmp.path(), &log[0].oid).unwrap();

        create_file(tmp.path(), "note.md", "forked");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()]).unwrap();
        svc.commit(&repo, tmp.path(), "fork commit", Some("my-fork")).unwrap();

        let info = svc.get_head_info(&repo, Some(&default_branch)).unwrap();
        assert!(!info.is_detached);
        assert_eq!(info.branch_name.as_deref(), Some("my-fork"));
        assert_eq!(info.commits_ahead, 1);
        assert_eq!(info.commits_behind, 0);
    }

    #[test]
    fn test_checkout_commit_invalid_oid() {
        let (tmp, _emitter, svc, repo) = setup();
        create_file(tmp.path(), "note.md", "v1");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()]).unwrap();
        svc.commit(&repo, tmp.path(), "initial", None).unwrap();

        let result = svc.checkout_commit(&repo, tmp.path(), "not-a-valid-oid");
        assert!(result.is_err());
    }

    // ── fork-on-commit tests ───────────────────────────────────────────────

    #[test]
    fn test_commit_with_branch_name_on_detached_head() {
        let (tmp, _emitter, svc, repo) = setup();

        create_file(tmp.path(), "note.md", "v1");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()]).unwrap();
        svc.commit(&repo, tmp.path(), "initial", None).unwrap();

        create_file(tmp.path(), "note.md", "v2");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()]).unwrap();
        svc.commit(&repo, tmp.path(), "second", None).unwrap();

        let log = svc.get_log(&repo, 10).unwrap();
        let first_oid = log.iter().find(|c| c.message == "initial").unwrap().oid.clone();
        svc.checkout_commit(&repo, tmp.path(), &first_oid).unwrap();

        create_file(tmp.path(), "note.md", "forked content");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()]).unwrap();

        let oid = svc.commit(&repo, tmp.path(), "forked commit", Some("my-fork")).unwrap();
        assert!(!oid.is_empty());

        assert!(!repo.head_detached().unwrap());
        let head = repo.head().unwrap();
        assert_eq!(head.shorthand().unwrap(), "my-fork");
    }

    #[test]
    fn test_commit_with_existing_branch_name_errors() {
        let (tmp, _emitter, svc, repo) = setup();

        create_file(tmp.path(), "note.md", "v1");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()]).unwrap();
        svc.commit(&repo, tmp.path(), "initial", None).unwrap();

        svc.create_branch(&repo, "taken").unwrap();

        let log = svc.get_log(&repo, 10).unwrap();
        svc.checkout_commit(&repo, tmp.path(), &log[0].oid).unwrap();

        create_file(tmp.path(), "note.md", "edited");
        svc.stage(&repo, tmp.path(), &["note.md".to_string()]).unwrap();

        let result = svc.commit(&repo, tmp.path(), "fork", Some("taken"));
        assert!(matches!(result, Err(AppError::BranchAlreadyExists { .. })));
    }
}
