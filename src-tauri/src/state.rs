use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

use crate::error::AppError;

/// Acquire a read lock, converting poisoned lock to AppError.
pub fn read_lock<T>(lock: &RwLock<T>) -> Result<RwLockReadGuard<'_, T>, AppError> {
    lock.read().map_err(|_| AppError::LockPoisoned)
}

/// Acquire a write lock, converting poisoned lock to AppError.
pub fn write_lock<T>(lock: &RwLock<T>) -> Result<RwLockWriteGuard<'_, T>, AppError> {
    lock.write().map_err(|_| AppError::LockPoisoned)
}

// Lock ordering invariant:
// When acquiring multiple locks, always acquire `workspace` before `vcs`.
// Today these locks are never held simultaneously (open_worktree_repo drops
// the workspace guard before vcs is acquired), but this ordering must be
// maintained if future code holds both concurrently.
