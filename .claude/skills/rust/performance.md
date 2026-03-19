# Rust Performance Patterns

## Minimize heap allocations

Every heap allocation involves a global lock and bookkeeping. Pre-allocate when you know the size, use `clone_from` to reuse existing allocations, and prefer the stack for small fixed-size data.

```rust
// ❌ BAD: Vec::new() grows through 4+ reallocations to hold 1000 items
let mut data = Vec::new();
for i in 0..1000 {
    data.push(i); // reallocates at 1, 2, 4, 8, 16, ... 512, 1024
}

// ✅ GOOD: single allocation up front
let mut data = Vec::with_capacity(1000);
for i in 0..1000 {
    data.push(i); // no reallocations
}

// ✅ GOOD: reuse existing heap memory instead of allocating a new buffer
buffer.clone_from(&source); // reuses buffer's allocation if large enough
```

**`SmallVec<[T; N]>`** stores up to N elements inline (on the stack), falling back to heap when exceeded. Best for many short vectors in a collection where cache locality is the main benefit. Always benchmark — `SmallVec` can be slower than `Vec` when N or T is large due to increased struct size.

**`ArrayVec<T, N>`** is a fixed-capacity, stack-only vector. Use when the maximum length is known at compile time and no heap fallback is needed.

## Iterators are zero-cost — prefer them over indexed loops

Iterator chains and manual loops produce identical assembly after optimization. Iterators avoid bounds checks and can be faster.

```rust
// ✅ Zero-cost iterator chain — no overhead vs hand-written loop
let total: i64 = data.iter()
    .map(|x| x * 2)
    .filter(|x| x % 3 == 0)
    .sum();
```

For SIMD auto-vectorization, use iterator-based code with `zip` and `chunks_exact`. Indexed loops with per-element bounds checks prevent vectorization. Verify with `cargo asm`.

## Generics vs trait objects: default to static dispatch

- **Static dispatch** (generics / `impl Trait`) — monomorphized at compile time, zero overhead, enables inlining.
- **Dynamic dispatch** (`dyn Trait`) — vtable lookups, prevents inlining, but produces smaller binaries and supports heterogeneous collections.

```rust
// ✅ Default: static dispatch — zero-cost, compiler can inline
fn process<T: Display>(item: T) {
    println!("{item}");
}

// ✅ When needed: dynamic dispatch for heterogeneous collections
fn render_all(widgets: &[Box<dyn Draw>]) {
    for w in widgets {
        w.draw();
    }
}
```

Use `dyn Trait` for plugin systems or to reduce binary bloat from excessive monomorphization.

**Hybrid approach** — write a thin generic wrapper that delegates to a `dyn Trait` inner function. This gives callers a clean generic API while keeping only one copy of the heavy implementation.

## Inline hints: primarily for cross-crate inlining

`#[inline]` is NOT about making code faster within a crate — the compiler already decides what to inline internally. Its primary use is **enabling cross-crate inlining**. Without it or LTO, functions cannot inline across crate boundaries.

Generic functions are implicitly inlinable (their definition is available to downstream crates).

**Never** spam `#[inline(always)]` on large functions — it hurts instruction cache performance.

```rust
// ✅ Small public library function — enable cross-crate inlining
#[inline]
pub fn is_valid(&self) -> bool {
    self.flags & VALID_MASK != 0
}
```

Consider LTO (`lto = true` in release profile) as an alternative that enables cross-crate inlining globally without manual annotations.

## String handling: &str vs String vs Cow<str>

| Type           | Use when                                                               |
| -------------- | ---------------------------------------------------------------------- |
| `&str`         | Function parameters (read-only), returning substrings, string literals |
| `String`       | Need ownership, mutation, storing in structs                           |
| `Cow<'a, str>` | Sometimes borrow, sometimes own — avoids allocation in the common case |

```rust
// ❌ BAD: accepts &String — forces caller to own a String
fn greet(name: &String) { ... }

// ✅ GOOD: accepts &str — works with &String, &str, string literals
fn greet(name: &str) { ... }
```

Avoid `format!()` when a string literal suffices — it always allocates. Use `String::with_capacity` when building a string incrementally.

## Benchmarking with Criterion

```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn bench_sort(c: &mut Criterion) {
    c.bench_function("sort 1000", |b| {
        b.iter_batched(
            || (0..1000).rev().collect::<Vec<u64>>(), // setup — not measured
            |mut data| {
                data.sort();
                black_box(data) // prevent dead-code elimination
            },
            criterion::BatchSize::SmallInput,
        );
    });
}

criterion_group!(benches, bench_sort);
criterion_main!(benches);
```

- **Always use `black_box()`** to prevent the compiler from optimizing away the computation under test.
- Use `iter_batched()` to separate setup from measured code.
- Set `codegen-units = 1` and `lto = true` in the release profile for consistent results.
- Run on a dedicated machine with minimal background load.

## Pitfalls

### Over-cloning is the #1 performance killer

Cloning `String` or `Vec<T>` performs deep copies with heap allocations. When the borrow checker fights you, restructure ownership — don't add `.clone()`.

Audit every `.clone()` in hot paths: can it be a borrow? A move? An `Arc`?

### Ignoring iterator chains

Manual indexed loops with `items[i]` are less idiomatic, introduce bounds checks, and miss optimization opportunities. Prefer `.iter().map().filter().collect()` chains.
