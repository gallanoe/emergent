# Rust Project Structure, Lints, and CI

## Workspace organization

Use Cargo workspaces for multi-crate projects — all members share a single `Cargo.lock`. Use `[workspace.dependencies]` with `dep.workspace = true` to eliminate version duplication (this is now standard practice).

```toml
# Cargo.toml (workspace root)
[workspace]
members = ["crates/*"]
resolver = "2"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
tracing = "0.1"

[workspace.lints.clippy]
pedantic = { level = "warn", priority = -1 }
unwrap_used = "deny"
```

```toml
# crates/my-lib/Cargo.toml
[package]
name = "my-lib"
edition = "2024"

[dependencies]
serde.workspace = true
tokio.workspace = true

[lints]
workspace = true
```

### Binary + library pattern

**Always** keep `main.rs` as a thin entry point, put all logic in `lib.rs`. Integration tests can only test the library crate — binary-only crates cannot have integration tests.

```rust
// src/main.rs — thin entry point
fn main() -> anyhow::Result<()> {
    my_app::run()
}
```

```rust
// src/lib.rs — all logic lives here
pub fn run() -> anyhow::Result<()> {
    // ...
    Ok(())
}
```

## Module visibility: default to private

| Modifier     | Scope         | Use case                         |
| ------------ | ------------- | -------------------------------- |
| _(private)_  | Same module   | Implementation details (default) |
| `pub(super)` | Parent module | Module-internal helpers          |
| `pub(crate)` | Current crate | Internal APIs across modules     |
| `pub`        | Everywhere    | Public API                       |

- Prefer `pub(crate)` over `pub` for items used across modules but not public API
- Keep struct fields private with public accessor methods to preserve invariants

```rust
// ✅ Expose only what consumers need
pub struct Config {
    host: String,      // private — invariant: always lowercase
    port: u16,         // private — invariant: non-zero
}

impl Config {
    pub fn host(&self) -> &str { &self.host }
    pub fn port(&self) -> u16 { self.port }
}
```

```rust
// ❌ Leaking implementation details
pub struct Config {
    pub host: String,  // anyone can set invalid values
    pub port: u16,
}
```

## Feature flags must be additive

- Enabling a feature should only add functionality, never change or remove existing behavior
- Code must compile with any combination of features
- Use `#[cfg(feature = "...")]` at module level, not scattered throughout code
- Rust 2024's `--check-cfg` catches typos like `#[cfg(feature = "widnows")]`

```toml
[features]
default = ["json"]
json = ["dep:serde_json"]  # dep: prefix avoids implicit feature names
xml = ["dep:quick-xml"]
```

Test with **both** `--all-features` and `--no-default-features` in CI.

```rust
// ✅ Feature gating at module level
#[cfg(feature = "json")]
mod json_support;

#[cfg(feature = "json")]
pub use json_support::JsonEncoder;
```

```rust
// ❌ Feature flags scattered through function bodies
pub fn encode(data: &Data) -> Vec<u8> {
    #[cfg(feature = "json")]
    let result = serde_json::to_vec(data).unwrap();
    #[cfg(not(feature = "json"))]
    let result = data.to_bytes(); // behavior changes — not additive
    result
}
```

## Documentation: every public item gets a doc comment

Follow RFC 1574 sections: **Examples** (required for public functions), **Errors**, **Panics**, **Safety** (for unsafe). Use intra-doc links: `[`Config::new`]`. Enable `#![warn(missing_docs)]` for library crates.

Doc examples are compiled and run as tests — leverage for living documentation.

````rust
/// Creates a new database connection using the provided [`Config`].
///
/// # Examples
///
/// ```
/// # use my_crate::Config;
/// let config = Config::builder()
///     .host("localhost")
///     .port(5432)
///     .build()?;
/// let conn = my_crate::connect(&config).await?;
/// # Ok::<(), my_crate::Error>(())
/// ```
///
/// # Errors
///
/// Returns [`ConnectionError::Timeout`] if the server does not respond
/// within the configured timeout period.
///
/// Returns [`ConnectionError::Auth`] if authentication fails.
pub async fn connect(config: &Config) -> Result<Connection, ConnectionError> {
    // ...
}
````

## Clippy lint configuration

Lint configuration in `Cargo.toml` is now the preferred approach over `#![warn(...)]` in source — it's cleaner and workspace-inheritable.

```toml
[lints.rust]
unsafe_code = "forbid"

[lints.clippy]
pedantic = { level = "warn", priority = -1 }
unwrap_used = "deny"
expect_used = "warn"
panic = "deny"
dbg_macro = "deny"
todo = "deny"
print_stdout = "warn"
print_stderr = "warn"
module_name_repetitions = "allow"
must_use_candidate = "allow"
missing_errors_doc = "allow"
```

- For AI-assisted development: `clippy::allow_attributes = "deny"` prevents AI from suppressing lints instead of fixing code
- `#[diagnostic::do_not_recommend]` helps library authors control compiler error messages

### Most impactful Clippy catches

- `clippy::needless_collect` — collecting only to iterate again (hidden allocation)
- `clippy::large_enum_variant` — one large variant inflates entire enum (box it)
- `clippy::redundant_clone` — unnecessary `.clone()` calls
- `clippy::await_holding_lock` — lock guard across `.await` (deadlock risk)
- `clippy::manual_map` / `clippy::manual_unwrap_or` — use `Option::map` etc.
- `clippy::unnecessary_to_owned` — `.to_string()` where `&str` suffices
- `clippy::wildcard_enum_match_arm` — explicit matching catches new variants

The `clippy::correctness` group is always-deny and catches outright bugs — never `#[allow]` these. The `clippy::restriction` group should **never** be enabled as a group — cherry-pick individual lints only.

```rust
// ✅ Fix the lint
fn process(items: &[Item]) -> Vec<String> {
    items.iter().map(|i| i.name().to_string()).collect()
}
```

```rust
// ❌ Suppress the lint (especially in AI-generated code)
#[allow(clippy::needless_collect)]
fn process(items: &[Item]) -> Vec<String> {
    let names: Vec<_> = items.iter().map(|i| i.name().to_string()).collect();
    names.into_iter().collect()
}
```

## Recommended CI pipeline

```yaml
- cargo fmt --check
- cargo clippy --all-targets --all-features -- -D warnings
- cargo test --all-features
- cargo test --no-default-features
- cargo doc --no-deps # catch doc warnings
- cargo deny check # supply chain security
```

## Rust 2024 edition highlights

The Rust 2024 edition was stabilized in Rust 1.85.0 (February 2025):

- **Unsafe operations inside `unsafe fn` now require explicit `unsafe {}` blocks** — improves auditability
- **`extern "C"` blocks must be declared `unsafe extern "C"`** — all FFI explicitly unsafe
- **`std::env::set_var` is now `unsafe`** — environment mutation is thread-unsafe
- **`gen` keyword is reserved** for future generator support
- **`Future` and `IntoFuture` added to standard prelude** — no more explicit imports

```rust
// ✅ Rust 2024 — explicit unsafe blocks inside unsafe fn
unsafe fn process_raw(ptr: *const u8, len: usize) -> &[u8] {
    unsafe { std::slice::from_raw_parts(ptr, len) }
}
```

```rust
// ❌ Pre-2024 — entire body implicitly unsafe (easy to miss bugs)
unsafe fn process_raw(ptr: *const u8, len: usize) -> &[u8] {
    std::slice::from_raw_parts(ptr, len)
}
```

```rust
// ✅ Rust 2024 — FFI blocks explicitly unsafe
unsafe extern "C" {
    fn sqlite3_open(filename: *const c_char, db: *mut *mut sqlite3) -> c_int;
}
```

## Declining patterns

- `extern crate` declarations — unnecessary since Rust 2018
- `Box<dyn std::error::Error>` — use `anyhow::Error` or custom error types
- Global `#![allow(clippy::all)]` — embrace stricter linting instead
- Library preludes — Tokio removed theirs; prefer explicit imports and `pub use` at crate root

```rust
// ✅ Modern error handling
fn load_config(path: &Path) -> anyhow::Result<Config> {
    let text = std::fs::read_to_string(path)?;
    let config: Config = toml::from_str(&text)?;
    Ok(config)
}
```

```rust
// ❌ Declining pattern
fn load_config(path: &Path) -> Result<Config, Box<dyn std::error::Error>> {
    let text = std::fs::read_to_string(path)?;
    let config: Config = toml::from_str(&text)?;
    Ok(config)
}
```
