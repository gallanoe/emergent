---
name: rust
description: Use when writing, reviewing, debugging, or optimizing Rust code — covers ownership, error handling, performance, API design, concurrency, and project setup
---

# Rust Guidelines

This skill is split into focused sub-files. **Read only the files relevant to your current task** to keep context lean.

## Sub-File Directory

| File                | Load when...                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ownership.md`      | Working with borrows, lifetimes, `Cow<T>`, interior mutability (`Cell`, `RefCell`, `Mutex`), or restructuring data ownership                                                           |
| `error-handling.md` | Defining error types, choosing `thiserror` vs `anyhow`, using `Result`/`Option` combinators, `let-else`, or adding error context                                                       |
| `performance.md`    | Optimizing allocations, using `Vec::with_capacity`/`SmallVec`, writing iterator chains, choosing generics vs `dyn Trait`, `#[inline]`, string handling, or benchmarking with Criterion |
| `api-design.md`     | Designing public APIs: newtype pattern, builder pattern, typestate, sealed traits, `From`/`Into`/`AsRef` conversions, associated types vs generics, common trait impls                 |
| `concurrency.md`    | Writing concurrent or async code: `Send`/`Sync`, `Arc<Mutex<T>>` vs channels, Rayon, `tokio::join!/select!/spawn`, `JoinSet`, deadlock prevention, atomics, async runtime rules        |
| `project-setup.md`  | Scaffolding a project, workspace layout, module visibility, feature flags, documentation conventions, Clippy lint config, CI pipeline, Rust 2024 edition                               |

## How to Use

1. Identify which sub-files match your task from the table above
2. Use the Read tool to load the relevant file(s) from this skill's directory
3. Load multiple files if your task spans concerns (e.g., defining error types for a concurrent service → `error-handling.md` + `concurrency.md`)

## Universal Rules (always apply)

- **Encode invariants in the type system** — newtypes, data-carrying enums, and typestate make illegal states unrepresentable at compile time
- **Let the caller decide ownership** — accept `&str` over `&String`, `&[T]` over `&Vec<T>`, take ownership only when storing
- **Measure before optimizing** — profile with `cargo flamegraph`, benchmark with Criterion, audit `.clone()` only after identifying hot paths
- **Default to `thiserror` for typed errors** callers match on; `anyhow` for errors callers just propagate
- **Prefer static dispatch** (generics/`impl Trait`) unless you need heterogeneous collections or plugin architectures
- **Never block the async executor** — use `tokio::fs`, `tokio::time::sleep`, or `spawn_blocking` for anything >10–100μs
