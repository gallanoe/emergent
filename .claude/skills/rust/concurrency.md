# Rust Concurrency, Parallelism, and Async

## Send and Sync: thread-safety guarantees

- **`Send`** — value can be transferred to another thread
- **`Sync`** — shared reference `&T` safe across threads
- Both are auto-derived. Notable exceptions: `Rc<T>` (neither), `Cell<T>`/`RefCell<T>` (not `Sync`), `MutexGuard<T>` (not `Send`)
- **Key inference:** `Mutex<T>: Sync` requires only `T: Send` (not `T: Sync`). `RwLock<T>: Sync` requires `T: Send + Sync`
- Never implement `Send`/`Sync` manually unless wrapping verified FFI types

## Shared state: choosing the right primitive

| Approach | Best for |
|----------|----------|
| `Arc<Mutex<T>>` | Shared mutable state, in-place updates, low-latency reads |
| `Arc<RwLock<T>>` | Read-heavy shared state (>90% reads) |
| Channels (`crossbeam`, `std::sync::mpsc`) | Producer/consumer pipelines, decoupled components |
| `ArcSwap` | Extremely read-heavy / write-rare (config hot-reloading) |

### Minimize lock scope

Clone data out, release the lock, then do expensive work.

```rust
// ✅ GOOD: copy value out in a block, lock released, then process
let snapshot = {
    let guard = state.lock().unwrap();
    guard.clone()
};
// Lock is released here — other threads can proceed
let result = expensive_computation(&snapshot);
```

```rust
// ❌ BAD: lock held during entire computation, blocking all other threads
let guard = state.lock().unwrap();
let result = expensive_computation(&guard);
drop(guard);
```

Since Rust 1.67, `std::sync::mpsc` uses crossbeam internals. `crossbeam-channel` still offers MPMC, `select!`, and richer APIs.

## Rayon for data parallelism

Drop-in `par_iter()` for CPU-bound work on large collections.

```rust
use rayon::prelude::*;

// ✅ GOOD: let rayon reduce — no locks, no shared state
let sum: i64 = data.par_iter().map(|x| x * x).sum();
```

```rust
// ❌ BAD: locking inside par_iter — lock contention per iteration kills parallelism
let total = Arc::new(Mutex::new(0i64));
data.par_iter().for_each(|x| {
    let mut t = total.lock().unwrap();
    *t += x * x;
});
```

```rust
// ✅ GOOD: let rayon reduce with .copied().sum() — zero contention
let sum: i64 = data.par_iter().copied().sum();
```

Helps for CPU-bound on large collections (>10K elements). Hurts for I/O-bound, tiny collections, or heavy sync.

## Async concurrency: join!, select!, and spawn

| Primitive | Behavior | Use case |
|-----------|----------|----------|
| `tokio::join!` | All futures complete, same task | Fan-out/fan-in, can borrow local data |
| `tokio::try_join!` | Short-circuits on first error | Same, with early exit on failure |
| `tokio::select!` | Races futures, cancels losers | Timeouts, graceful shutdown |
| `tokio::spawn` | Independent task on separate thread | Background work, requires `'static + Send` |

```rust
// ✅ GOOD: graceful shutdown with select! loop
let mut shutdown = tokio::signal::ctrl_c();
loop {
    tokio::select! {
        Some(msg) = rx.recv() => {
            handle_message(msg).await;
        }
        _ = &mut shutdown => {
            eprintln!("Shutting down gracefully...");
            break;
        }
    }
}
```

Use **`JoinSet`** for dynamically spawning and collecting many tasks:

```rust
let mut set = tokio::task::JoinSet::new();
for url in urls {
    set.spawn(fetch(url));
}
while let Some(result) = set.join_next().await {
    process(result??);
}
```

## Async runtime: never block the executor

Tokio tasks are cooperative. Any operation >10-100us is "blocking" and starves other tasks.

```rust
// ❌ BAD: std::fs::read_to_string in async function — BLOCKS the executor
async fn load_config() -> String {
    std::fs::read_to_string("config.toml").unwrap() // blocks entire thread
}
```

```rust
// ✅ GOOD: tokio::fs::read_to_string — async I/O
async fn load_config() -> String {
    tokio::fs::read_to_string("config.toml").await.unwrap()
}
```

```rust
// ✅ GOOD: spawn_blocking for unavoidable sync work
let hash = tokio::task::spawn_blocking(move || {
    argon2::hash_password(password.as_bytes(), &salt)
}).await?;
```

- Use **`tokio::sync::Mutex`** (not `std::sync::Mutex`) in async contexts — yields while waiting
- Never hold a `std::sync::MutexGuard` across an `.await` point

## Avoiding deadlocks

- Most common: same-thread double-locking of non-reentrant `Mutex`
- For multi-lock: **always acquire in consistent global order**
- Use `try_lock()` for non-blocking attempts
- Never hold `std::sync::MutexGuard` across `.await`
- Consider `lockbud` crate for static deadlock detection

## Atomics: start with SeqCst, downgrade only after analysis

- **`Relaxed`** — simple counters and statistics
- **`Acquire`/`Release` pairs** — flag-based synchronization
- **`SeqCst`** — default when uncertain (slightly slower correct > fast incorrect)
- Atomics only for numeric, boolean, pointer types; use locks for complex types

```rust
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

// ✅ GOOD: shutdown flag pattern with AtomicBool
let running = Arc::new(AtomicBool::new(true));
let flag = running.clone();

let worker = std::thread::spawn(move || {
    while flag.load(Ordering::Acquire) {
        do_work();
    }
});

// Signal shutdown from another thread
running.store(false, Ordering::Release);
worker.join().unwrap();
```

## Scoped threads borrow local data without Arc

Since Rust 1.63, `std::thread::scope` borrows non-`'static` local data. All scoped threads are guaranteed joined on scope exit.

```rust
let mut data = vec![1, 2, 3, 4, 5, 6];
let (left, right) = data.split_at_mut(3);

std::thread::scope(|s| {
    s.spawn(|| {
        for val in left.iter_mut() {
            *val *= 10;
        }
    });
    s.spawn(|| {
        for val in right.iter_mut() {
            *val *= 20;
        }
    });
});
// No Arc needed — data is still usable after the scope
assert_eq!(data, vec![10, 20, 30, 80, 100, 120]);
```

## Ecosystem notes (2024-2025)

- **Tokio is the de facto standard** async runtime. `async-std` was discontinued March 2025; `smol` is the suggested lightweight alternative
- **Async closures** (`async || {}`) with `AsyncFn` traits stabilized in Rust 1.85
- **Native async fn in traits** (stable since 1.75) supersedes the `async-trait` proc macro for most use cases
- **Axum has overtaken Actix Web** as preferred web framework due to Tower middleware compatibility
