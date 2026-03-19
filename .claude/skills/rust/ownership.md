# Rust Ownership, Borrowing, and Lifetimes

## Take ownership when storing, borrow when reading

Functions that store values should take ownership. Functions that only read should borrow.

```rust
// ✅ GOOD: takes ownership because it stores the values
fn register_user(name: String, email: String) -> User {
    User { name, email }
}

// ✅ GOOD: borrows because it only reads
fn validate_email(email: &str) -> bool {
    email.contains('@') && email.contains('.')
}
```

```rust
// ❌ BAD: borrows then clones internally — hidden allocation the caller can't avoid
fn register_user(name: &str, email: &str) -> User {
    User {
        name: name.to_string(),  // hidden clone
        email: email.to_string(), // hidden clone
    }
}

// ❌ BAD: takes ownership without needing it — forces caller to clone
fn validate_email(email: String) -> bool {
    email.contains('@') && email.contains('.')
}
```

**Rule of thumb:** if the function signature borrows but the body clones, change the signature to take ownership and let the caller decide when to clone.

## Accept slices over concrete types

Prefer the most general borrowed form so callers aren't forced into a specific container.

```rust
// ✅ GOOD: accepts &str — works with String, &str, Cow<str>, slices, etc.
fn is_valid_username(name: &str) -> bool {
    name.len() >= 3 && name.chars().all(|c| c.is_alphanumeric())
}

// ❌ BAD: requires &String — forces caller to own a String
fn is_valid_username(name: &String) -> bool { /* ... */ }
```

```rust
// ✅ GOOD: accepts &[T] — works with Vec, arrays, slices
fn sum(values: &[i32]) -> i32 {
    values.iter().sum()
}

// ❌ BAD: requires &Vec<T>
fn sum(values: &Vec<i32>) -> i32 { /* ... */ }
```

```rust
// ✅ GOOD: accepts anything convertible to a Path
fn read_config(path: impl AsRef<Path>) -> Result<Config> {
    let content = std::fs::read_to_string(path)?;
    toml::from_str(&content).map_err(Into::into)
}

// Works with all of these:
read_config("config.toml");
read_config(String::from("config.toml"));
read_config(PathBuf::from("/etc/app/config.toml"));
```

## Lifetime elision rules

The compiler applies three rules to infer lifetimes so you don't write them explicitly:

1. **Each input reference gets a distinct lifetime** — `fn f(a: &str, b: &str)` becomes `fn f<'a, 'b>(a: &'a str, b: &'b str)`.
2. **Single input lifetime propagates to all outputs** — `fn f(s: &str) -> &str` becomes `fn f<'a>(s: &'a str) -> &'a str`.
3. **`&self` / `&mut self` lifetime propagates to outputs** — methods returning references are tied to `self`.

### When explicit lifetimes are needed

**Output depends on multiple input references:**

```rust
// Compiler can't know which input the output borrows from — must be explicit.
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() >= y.len() { x } else { y }
}
```

**Struct holds a reference:**

```rust
struct Parser<'a> {
    input: &'a str,
    position: usize,
}

impl<'a> Parser<'a> {
    fn new(input: &'a str) -> Self {
        Parser { input, position: 0 }
    }

    fn remaining(&self) -> &'a str {
        &self.input[self.position..]
    }
}

// Use anonymous lifetime '_ in impls where the lifetime is unambiguous.
impl fmt::Display for Parser<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Parser at position {} of {:?}", self.position, self.input)
    }
}
```

**Prefer owned data in struct fields.** Lifetime parameters are infectious — they propagate to every type that contains the struct, every impl block, and every function that returns it. Use `String` over `&str` in structs unless the struct is explicitly a short-lived view into borrowed data (like `Parser` above).

```rust
// ✅ GOOD: owned data — no lifetime propagation
struct User {
    name: String,
    email: String,
}

// ❌ BAD (usually): lifetimes infect everything that touches User
struct User<'a> {
    name: &'a str,
    email: &'a str,
}
```

## Cow\<T\>: avoid allocation in the common case

`Cow<'a, B>` (Clone-on-Write) is either `Borrowed` or `Owned`. Use it when most inputs pass through unchanged but some need modification.

```rust
use std::borrow::Cow;

// ✅ Most strings pass through without allocation; only whitespace-heavy ones allocate.
fn normalize_whitespace(input: &str) -> Cow<'_, str> {
    if input.contains("  ") {
        // Rare path: allocate and fix
        let normalized = input.split_whitespace().collect::<Vec<_>>().join(" ");
        Cow::Owned(normalized)
    } else {
        // Common path: zero-cost borrow
        Cow::Borrowed(input)
    }
}
```

```rust
// ✅ Cow<'static, str> for mixing static and dynamic strings — avoids allocating
//    for the common static case.
fn error_message(code: u16) -> Cow<'static, str> {
    match code {
        404 => Cow::Borrowed("not found"),
        500 => Cow::Borrowed("internal server error"),
        _   => Cow::Owned(format!("unknown error code: {code}")),
    }
}
```

**When NOT to use Cow:**

- If you always mutate the data, just return an owned type — Cow adds complexity for no benefit.
- If the lifetime burden spreads through your API, the ergonomic cost outweighs the allocation savings.

## Interior mutability: choosing the right tool

| Type | Thread-safe | Use case |
|------|-------------|----------|
| `Cell<T>` | No | Small `Copy` types (counters, flags) — zero runtime cost |
| `RefCell<T>` | No | Non-`Copy` types, single-threaded — runtime-checked borrows |
| `Mutex<T>` | Yes | Exclusive access across threads |
| `RwLock<T>` | Yes | Read-heavy multi-threaded workloads |
| `OnceLock<T>` | Yes | One-time initialization of a shared value |

**Common pairings:**

- `Rc<RefCell<T>>` — single-threaded shared mutable ownership.
- `Arc<Mutex<T>>` — multi-threaded shared mutable ownership.
- Never combine `Arc` with `RefCell` — `RefCell` is `!Sync`, so `Arc<RefCell<T>>` won't compile when you try to share it across threads.

### Cell for lightweight mutation in structs

```rust
use std::cell::Cell;

struct Stats {
    query_count: Cell<u64>,
}

impl Stats {
    fn record_query(&self) {
        // Mutates through &self — no &mut needed
        self.query_count.set(self.query_count.get() + 1);
    }
}
```

### Minimizing lock scope with Arc\<Mutex\<T\>\>

```rust
use std::sync::{Arc, Mutex};

fn update_cache(cache: &Arc<Mutex<HashMap<String, String>>>, key: String, raw: &str) {
    // ✅ GOOD: compute outside the lock
    let value = expensive_transform(raw);

    // Lock only for the mutation
    {
        let mut map = cache.lock().unwrap();
        map.insert(key, value);
    } // lock dropped here

    notify_subscribers();
}
```

```rust
// ❌ BAD: holding the lock during computation blocks all other threads
fn update_cache(cache: &Arc<Mutex<HashMap<String, String>>>, key: String, raw: &str) {
    let mut map = cache.lock().unwrap();
    let value = expensive_transform(raw); // other threads blocked here
    map.insert(key, value);
    notify_subscribers(); // still blocked
}
```

## Pitfalls

### Stringly-typed code defeats the compiler

```rust
// ❌ BAD: magic strings — typos compile fine, no exhaustiveness checking
fn set_status(status: &str) {
    match status {
        "active" => { /* ... */ }
        "inactive" => { /* ... */ }
        _ => panic!("unknown status"), // runtime bomb
    }
}

set_status("actve"); // typo compiles, panics at runtime
```

```rust
// ✅ GOOD: enum — compiler catches typos, match is exhaustive
enum Status {
    Active,
    Inactive,
}

fn set_status(status: Status) {
    match status {
        Status::Active => { /* ... */ }
        Status::Inactive => { /* ... */ }
        // no wildcard needed — adding a variant forces updating every match
    }
}
```

### Fighting the borrow checker with RefCell everywhere

If you find yourself wrapping everything in `RefCell`, the problem is almost always data structure design, not the borrow checker being too strict.

```rust
// ❌ BAD: RefCell as a band-aid for poor ownership design
struct App {
    state: RefCell<AppState>,
    config: RefCell<Config>,
    cache: RefCell<HashMap<String, String>>,
}
```

**Fix: restructure ownership so mutable access flows through `&mut self`.**

```rust
// ✅ GOOD: direct ownership — &mut self gives mutable access naturally
struct App {
    state: AppState,
    config: Config,
    cache: HashMap<String, String>,
}

impl App {
    fn update(&mut self) {
        // Full mutable access to all fields through &mut self
        self.cache.insert(self.config.key(), self.state.summary());
    }
}
```

Reserve `RefCell` for genuinely unavoidable cases — most commonly, caching or lazy computation behind a `&self` interface:

```rust
// ✅ Legitimate RefCell use: caching behind an immutable interface
struct Renderer {
    template: String,
    compiled: RefCell<Option<CompiledTemplate>>,
}

impl Renderer {
    fn render(&self, data: &Data) -> String {
        let mut compiled = self.compiled.borrow_mut();
        let tmpl = compiled.get_or_insert_with(|| compile(&self.template));
        tmpl.render(data)
    }
}
```
