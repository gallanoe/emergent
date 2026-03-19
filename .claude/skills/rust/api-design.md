# Rust API Design and Type System Patterns

## The newtype pattern encodes meaning in types

Wrap primitive types to prevent confusion. The Mars Climate Orbiter was lost because of a unit mixup between pounds-force seconds and newton-seconds. Newtypes prevent this class of bug at zero cost — the compiled machine code is identical to the inner type.

```rust
// ✅ GOOD: distinct types prevent argument mixups
struct UserId(u64);
struct OrderId(u64);

fn find_order(user: UserId, order: OrderId) -> Option<Order> {
    // ...
}

// Compiler catches the mistake:
// find_order(order_id, user_id);  // ERROR: expected UserId, found OrderId
```

```rust
// ❌ BAD: type aliases provide zero safety
type UserId = u64;
type OrderId = u64;

fn find_order(user: UserId, order: OrderId) -> Option<Order> {
    // ...
}

// Compiles silently — both are just u64:
find_order(order_id, user_id);  // No error. Bug ships to production.
```

**Do not implement `Deref` on semantic newtypes** (API Guideline C-DEREF: only smart pointers should implement `Deref`). It breaks encapsulation by exposing the inner type's full API. Use explicit accessor methods instead:

```rust
// ✅ GOOD: explicit access
impl UserId {
    pub fn as_u64(&self) -> u64 {
        self.0
    }
}

// ❌ BAD: Deref on a semantic newtype
impl Deref for UserId {
    type Target = u64;
    fn deref(&self) -> &u64 { &self.0 }
}
```

## The builder pattern: two canonical variants

### Non-consuming builder (`&mut self`) — reusable

The builder can be used multiple times. `std::process::Command` uses this style.

```rust
// ✅ GOOD: non-consuming builder, can be reused
let mut cmd = Command::new("cargo");
cmd.arg("build");
cmd.arg("--release");

let debug = cmd.arg("--debug").spawn();   // reuse same builder
let release = cmd.arg("--release").spawn();
```

### Consuming builder (`self`) — enforces single use

Building consumes the configuration. `reqwest::RequestBuilder` uses this style.

```rust
// ✅ GOOD: consuming builder, each call returns a new builder
let response = reqwest::Client::new()
    .get("https://api.example.com/data")
    .header("Authorization", token)
    .send()    // consumes the builder
    .await?;
```

### Typestate builder — compile-time required field enforcement

For safety-critical APIs, use the type system to enforce that all required fields are set before `build()` can be called. Never make `build()` panic at runtime for missing required fields — use the type system instead.

```rust
use std::marker::PhantomData;

struct Yes;
struct No;

struct ServerBuilder<HasPort, HasHost> {
    port: Option<u16>,
    host: Option<String>,
    max_connections: usize,
    _port: PhantomData<HasPort>,
    _host: PhantomData<HasHost>,
}

impl ServerBuilder<No, No> {
    pub fn new() -> Self {
        ServerBuilder {
            port: None,
            host: None,
            max_connections: 100,
            _port: PhantomData,
            _host: PhantomData,
        }
    }
}

impl<H> ServerBuilder<No, H> {
    pub fn port(self, port: u16) -> ServerBuilder<Yes, H> {
        ServerBuilder {
            port: Some(port),
            host: self.host,
            max_connections: self.max_connections,
            _port: PhantomData,
            _host: PhantomData,
        }
    }
}

impl<P> ServerBuilder<P, No> {
    pub fn host(self, host: impl Into<String>) -> ServerBuilder<P, Yes> {
        ServerBuilder {
            port: self.port,
            host: Some(host.into()),
            max_connections: self.max_connections,
            _port: PhantomData,
            _host: PhantomData,
        }
    }
}

impl ServerBuilder<Yes, Yes> {
    // build() is ONLY available when both port and host are set
    pub fn build(self) -> Server {
        Server {
            port: self.port.unwrap(),
            host: self.host.unwrap(),
            max_connections: self.max_connections,
        }
    }
}

// ✅ Compiles:
let server = ServerBuilder::new()
    .host("localhost")
    .port(8080)
    .build();

// ❌ Compile error — build() doesn't exist on ServerBuilder<No, Yes>:
// let server = ServerBuilder::new()
//     .host("localhost")
//     .build();
```

## Making illegal states unrepresentable

This is the most powerful type system pattern in Rust. Use enums with data-carrying variants so each state carries exactly the data it needs — no more, no less.

```rust
// ❌ BAD: illegal states are representable
struct Connection {
    is_connected: bool,
    socket: Option<TcpStream>,
    last_error: Option<io::Error>,
    retry_count: u32,
}
// What does is_connected=false + socket=Some(...) mean?
// What does is_connected=true + socket=None mean?
// The type allows both — bugs waiting to happen.
```

```rust
// ✅ GOOD: each state carries exactly its data
enum Connection {
    Disconnected,
    Connected {
        socket: TcpStream,
    },
    Error {
        last_error: io::Error,
        retry_count: u32,
    },
}

// Pattern matching forces you to handle every state:
match connection {
    Connection::Disconnected => attempt_connect(),
    Connection::Connected { socket } => send_data(socket),
    Connection::Error { last_error, retry_count } if retry_count < 3 => {
        log::warn!("Retrying after: {last_error}");
        attempt_connect()
    }
    Connection::Error { last_error, .. } => return Err(last_error),
}
```

Combine these techniques for layered safety:

- **Newtypes** for validated construction (`Username::new()` returns `Result`)
- **Enums** for state modeling (each variant carries its own data)
- **Private fields** with public constructors (enforce invariants at creation)

## The typestate pattern: zero-cost state machines

Encode state transitions using zero-sized marker types and `PhantomData`. State transitions consume `self` and return a new type, which prevents use of the old state.

```rust
// Zero-sized marker types — no runtime cost
struct Draft;
struct Published;

struct Article<State> {
    title: String,
    content: String,
    _state: PhantomData<State>,
}

impl Article<Draft> {
    pub fn new(title: String, content: String) -> Self {
        Article { title, content, _state: PhantomData }
    }

    // Consuming self: Draft article is gone after publishing
    pub fn publish(self) -> Article<Published> {
        Article {
            title: self.title,
            content: self.content,
            _state: PhantomData,
        }
    }
}

impl Article<Published> {
    // view() only exists on Published articles
    pub fn view(&self) -> &str {
        &self.content
    }
}

// ✅ Works:
let draft = Article::<Draft>::new("Hello".into(), "World".into());
let published = draft.publish();
println!("{}", published.view());

// ❌ Compile error — view() does not exist on Article<Draft>:
// let draft = Article::<Draft>::new("Hello".into(), "World".into());
// draft.view();

// ❌ Compile error — draft was consumed by publish():
// let draft = Article::<Draft>::new("Hello".into(), "World".into());
// let published = draft.publish();
// draft.publish();  // use of moved value
```

## Sealed traits prevent external implementation

Use the sealed trait pattern (C-SEALED) for public traits that external crates should not implement. This preserves the ability to add new methods in future versions without breaking changes.

```rust
// ✅ GOOD: sealed trait
pub trait DatabaseDriver: private::Sealed {
    fn connect(&self, url: &str) -> Result<Connection>;
    fn execute(&self, query: &str) -> Result<Rows>;
}

// Private module — external crates cannot access this
mod private {
    pub trait Sealed {}
}

// Only types in this crate can implement Sealed, and therefore DatabaseDriver
impl private::Sealed for PostgresDriver {}
impl DatabaseDriver for PostgresDriver {
    fn connect(&self, url: &str) -> Result<Connection> { /* ... */ }
    fn execute(&self, query: &str) -> Result<Rows> { /* ... */ }
}

impl private::Sealed for SqliteDriver {}
impl DatabaseDriver for SqliteDriver {
    fn connect(&self, url: &str) -> Result<Connection> { /* ... */ }
    fn execute(&self, query: &str) -> Result<Rows> { /* ... */ }
}

// External crates see DatabaseDriver but cannot implement it:
// impl emergent::DatabaseDriver for MyDriver {}  // ERROR: Sealed is not accessible
```

## Conversion trait conventions

**Always implement `From`, never `Into` directly** — a blanket impl in the standard library gives you `Into` for free when you implement `From`.

```rust
// ✅ GOOD: implement From
impl From<UserId> for u64 {
    fn from(id: UserId) -> u64 {
        id.0
    }
}
// Now both work: u64::from(user_id) and user_id.into()

// ❌ BAD: implementing Into directly
impl Into<u64> for UserId {
    fn into(self) -> u64 { self.0 }
}
```

Use `impl Into<String>` and `impl AsRef<Path>` in function parameters for ergonomic APIs:

```rust
// ✅ GOOD: accepts &str, String, Cow<str>, and anything else convertible
pub fn new(name: impl Into<String>) -> Self {
    Self { name: name.into() }
}

// ✅ GOOD: accepts &str, &Path, PathBuf, String, &String, etc.
pub fn read_file(path: impl AsRef<Path>) -> io::Result<String> {
    std::fs::read_to_string(path.as_ref())
}
```

### Naming conventions for conversions

| Prefix   | Cost               | Ownership          | Example         |
|----------|--------------------|--------------------|-----------------|
| `as_`    | Free, borrow-to-borrow | Borrows input   | `as_str()`      |
| `to_`    | Potentially expensive  | May allocate     | `to_string()`   |
| `into_`  | Ownership transfer     | Consumes input   | `into_inner()`  |

## Trait design: associated types vs generics

Use **associated types** when there is one natural implementation per type:

```rust
// ✅ Associated type: an iterator has exactly one Item type
trait Iterator {
    type Item;
    fn next(&mut self) -> Option<Self::Item>;
}
```

Use **generic parameters** when a type may implement the trait multiple times:

```rust
// ✅ Generic parameter: a type can be converted from many sources
trait From<T> {
    fn from(value: T) -> Self;
}

impl From<&str> for String { /* ... */ }
impl From<char> for String { /* ... */ }
impl From<Vec<u8>> for String { /* ... */ }
```

### Trait implementation checklist

Every public type should implement `Debug` (C-DEBUG). Eagerly implement these common traits when they make sense:

- `Clone` — if the type can be duplicated
- `Eq`, `PartialEq` — if equality comparison is meaningful
- `Ord`, `PartialOrd` — if ordering is meaningful
- `Hash` — if the type will be used in hash maps/sets (requires `Eq`)
- `Default` — if there is an obvious default value
- `Display` — if the type has a user-facing string representation
- `Send`, `Sync` — derived automatically when all fields are `Send`/`Sync`; be intentional about opting out
