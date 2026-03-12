use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "data")]
pub enum AppError {
    #[error("document not found: {path}")]
    DocumentNotFound { path: String },

    #[error("branch already exists: {name}")]
    BranchAlreadyExists { name: String },

    #[error("merge conflict in {paths:?}")]
    #[allow(dead_code)]
    MergeConflict { paths: Vec<String> },

    #[error("no workspace is open")]
    WorkspaceNotOpen,

    #[error("git error: {message}")]
    GitError { message: String },

    #[error("folder not found: {path}")]
    FolderNotFound { path: String },

    #[error("document already exists: {path}")]
    DocumentAlreadyExists { path: String },

    #[error("{message}")]
    Internal { message: String },
}

impl From<git2::Error> for AppError {
    fn from(e: git2::Error) -> Self {
        AppError::GitError {
            message: e.message().to_string(),
        }
    }
}
