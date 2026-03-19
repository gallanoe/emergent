# Rust Error Handling and Result/Option Idioms

## thiserror vs anyhow: reason about caller intent

Choose based on how callers consume the error:

- If callers need to **match on error variants** (retry on timeout, return 404 on not-found) → use `thiserror` for typed errors.
- If callers just **propagate and report** → use `anyhow` for ergonomic context chaining.

✅ Library example — callers match on variants:

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DatabaseError {
    #[error("connection timed out after {timeout_ms}ms")]
    Timeout { timeout_ms: u64 },

    #[error("record not found: {id}")]
    NotFound { id: String },

    #[error("query failed")]
    QueryFailed(#[source] sqlx::Error),
}

// Caller can pattern-match:
match db.fetch_user(id).await {
    Err(DatabaseError::NotFound { .. }) => return Ok(HttpResponse::NotFound()),
    Err(DatabaseError::Timeout { .. }) => retry(/* ... */),
    Err(e) => return Err(e.into()),
    Ok(user) => { /* ... */ }
}
```

✅ Application example — just propagate with context:

```rust
use anyhow::{Context, Result};

fn run_migration(db_url: &str) -> Result<()> {
    let conn = Connection::open(db_url)
        .context("failed to open database connection")?;

    conn.execute_batch(include_str!("migrations/001.sql"))
        .context("failed to apply migration 001")?;

    Ok(())
}
```

**Hybrid approach** — typed errors with an escape hatch for unexpected failures:

```rust
#[derive(thiserror::Error, Debug)]
pub enum ServiceError {
    #[error("record not found: {0}")]
    NotFound(String),

    #[error(transparent)]
    UnexpectedError(#[from] anyhow::Error),
}
```

> Note: `Box<dyn std::error::Error>` is superseded by `anyhow::Error` or custom error types. Prefer those instead.

## #[source] vs #[from]

- `#[from]` auto-generates a `From` impl — use it when the mapping is **unique** (one inner type → one variant).
- `#[source]` sets the error source without generating `From` — use it when the **same inner error type appears in multiple variants**. Disambiguate with `map_err`.

```rust
#[derive(thiserror::Error, Debug)]
pub enum ProcessingError {
    #[error("failed to read input")]
    ReadError(#[source] std::io::Error),

    #[error("failed to write output")]
    WriteError(#[source] std::io::Error),
}

fn process(input: &Path, output: &Path) -> Result<(), ProcessingError> {
    let data = std::fs::read(input)
        .map_err(ProcessingError::ReadError)?;

    std::fs::write(output, &data)
        .map_err(ProcessingError::WriteError)?;

    Ok(())
}
```

## Scope error enums per module or operation

Avoid "ball of mud" error enums that accumulate every error type in the crate. Instead, define error types close to the module or operation that produces them. A top-level error can compose inner errors via `#[from]` or `#[source]` where needed.

## Option combinators eliminate nested matches

❌ BAD — nested matches obscure the intent:

```rust
fn get_user_email(id: u64) -> Option<String> {
    match get_user(id) {
        Some(user) => match user.get_email() {
            Some(email) => Some(email),
            None => None,
        },
        None => None,
    }
}
```

✅ GOOD — combinator chain reads linearly:

```rust
fn get_user_email(id: u64) -> Option<String> {
    get_user(id).and_then(|user| user.get_email())
}
```

✅ GOOD — `let-else` (Rust 1.65+) for Option in Result-returning functions:

```rust
fn process_order(order_id: u64) -> Result<Receipt> {
    let Some(order) = find_order(order_id) else {
        return Err(anyhow!("order {order_id} not found"));
    };

    let Some(item) = order.primary_item() else {
        return Err(anyhow!("order {order_id} has no items"));
    };

    charge(item.price())
}
```

**Key combinators reference:**

| Combinator       | Purpose                                             |
| ---------------- | --------------------------------------------------- |
| `map`            | Transform the inner value                           |
| `and_then`       | Chain / flatmap (returns `Option`)                  |
| `unwrap_or_else` | Lazy default when `None`                            |
| `filter`         | Conditional — keeps `Some` only if predicate passes |
| `ok_or_else`     | Convert `Option` → `Result`                         |

## When to panic vs return Result

- **Panic** for programming bugs, broken invariants, and hardcoded values known to be valid.
- **Return Result** for expected failures — I/O, parsing, network, user input.
- In library code, **never** panic on user input.
- Prefer `expect("reason")` over bare `unwrap()` — it documents why the value can't be `None`/`Err`.

```rust
// Hardcoded value — panic is fine, documents the reasoning
let addr: IpAddr = "127.0.0.1".parse().expect("hardcoded IP address should be valid");

// User-supplied value — always return Result
fn parse_config(path: &Path) -> Result<Config> {
    let contents = std::fs::read_to_string(path)
        .context("failed to read config file")?;
    toml::from_str(&contents)
        .context("failed to parse config file")
}
```

## Error context: each level describes only itself

Each call site should add context about **what it was doing**, not duplicate the underlying cause. The error chain preserves the full story automatically.

❌ BAD — duplicates the cause in the message:

```rust
let offset = fetch_offset(&conn)
    .map_err(|e| anyhow!("failed to fetch offset: {}", e))?;
// Prints: "failed to fetch offset: MySQL error: connection refused"
// The cause is stringified and flattened — you lose the typed source chain.
```

✅ GOOD — preserves the chain, each layer adds its own context:

```rust
let offset = fetch_offset(&conn)
    .context("failed to fetch offset")?;
// With {:#}: "failed to fetch offset: MySQL error: connection refused"
// The source chain is intact and inspectable programmatically.
```

**Guidelines:**

- Use `.context("static message")` for cheap, allocation-free strings.
- Use `.with_context(|| format!("failed to process item {id}"))` when you need dynamic values (avoids formatting on the success path).
- For reporting, `{:#}` on `anyhow::Error` prints the full chain. `{:?}` includes backtraces when `RUST_BACKTRACE=1` is set.
