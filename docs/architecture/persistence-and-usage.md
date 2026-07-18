# Persistence Model & Usage Accounting

How Emergent survives a restart: a small set of per-workspace JSON files on the
host filesystem, plus a token/cost usage pipeline that folds cumulative-per-session
ACP reports into durable per-agent totals. There is no database — the in-memory
maps are authoritative and the files are rebuilt from them.

> **Context correction:** Emergent runs each agent as a **local host process** with
> an isolated `$HOME`, not inside a Docker container. Persistence therefore lives on
> the ordinary host filesystem under `~/.emergent`, not in container volumes. See
> [system-overview](./system-overview.md) and
> [workspaces-and-terminals](./workspaces-and-terminals.md).

Related: [runtime-lifecycle](./runtime-lifecycle.md) (when these files are read
and written during boot/shutdown) ·
[agent-lifecycle-and-acp](./agent-lifecycle-and-acp.md) (who produces usage
events) · [notifications-and-protocol](./notifications-and-protocol.md) (the
`TurnUsage`/`TokenUsage` wire types) ·
[known-limitations](./known-limitations.md) (the gotchas flagged below) ·
[reference/ipc-and-events](../reference/ipc-and-events.md) (`get_workspace_usage`)
· Back to the [docs index](../README.md).

---

## 1. Where state lives

Everything durable is a file under one directory per workspace:

```text
~/.emergent/                          emergent_root()
└── <workspace-id>/                   WorkspacePaths::dir()
    ├── metadata.json                 workspace identity      (WorkspaceManager)
    ├── agents.json                   agent definitions       (AgentRegistry)
    ├── threads.json                  thread mappings + usage (ThreadManager)   ← the usage store lives here
    ├── tasks.json                    task graph              (TaskRegistry)
    └── agents/
        └── <agent-id>/               the agent's $HOME + cwd (config lives here, not persisted by us)
```

`WorkspacePaths` resolves the directory _hierarchy_ and hands each registry its
`workspace_dir` rather than letting registries recompute paths — but it is **not**
a source of truth for the sibling JSON _filenames_: each registry hardcodes its own
`workspace_dir.join(…)`, so filenames live with their owners. Ids are short random
hex, not UUIDs (see the uniqueness note under `tasks.json`).

**Invariant (single owner per file):** each JSON file is written by exactly one
subsystem; nothing writes another's.

| File            | Owner              | Holds                                                 | Write strategy                                      |
| --------------- | ------------------ | ----------------------------------------------------- | --------------------------------------------------- |
| `metadata.json` | `WorkspaceManager` | workspace identity (the durable seed for rehydration) | direct overwrite                                    |
| `agents.json`   | `AgentRegistry`    | this workspace's agent definitions                    | direct overwrite                                    |
| `threads.json`  | `ThreadManager`    | resume records **+** durable usage totals             | atomic (unique-temp + rename, under `persist_lock`) |
| `tasks.json`    | `TaskRegistry`     | this workspace's task slice                           | atomic (fixed-temp + rename)                        |

### The files, briefly

- **`metadata.json`** is deliberately tiny (the durable seed for rehydration).
  `create_workspace` / `update_workspace` write it **before** mutating memory
  (write-ahead), so a failed durable write can never leave memory ahead of disk.

- **`agents.json`** and **`tasks.json`** are each a per-workspace _slice_ of a
  single **global** map spanning all workspaces: save writes the local slice, load
  **merges by id** back into the shared map (idempotent). This makes global id
  uniqueness load-bearing — see
  [task-and-swarm-coordination](./task-and-swarm-coordination.md). Per-agent CLI
  config (`.claude`, `.codex`, …) lives under `agents/<agent-id>/` and is written
  by the agent CLI itself — Emergent never serializes it.

- **`threads.json`** is the important one — it carries both the ACP resume records
  (thread ↔ session ↔ task mappings) and the durable usage totals, wrapped in a
  versioned envelope (`PersistedWorkspaceState`; Sections 4–5, 7).

---

## 2. Write strategy: atomic vs direct, and why

`threads.json` and `tasks.json` use temp-file + `rename` (atomic on the same
filesystem); `metadata.json` and `agents.json` overwrite in place.

- **`threads.json` — unique temp name + `persist_lock`.** `save_state_to_dir`
  writes to a randomly-named temp file, then renames it over `threads.json`.
  - **Why a _unique_ temp name:** the recorder persists after _every_ accounted
    turn (Section 7), so two persists can overlap. A fixed `threads.json.tmp` could
    interleave into a torn staging file; a per-write random name means concurrent
    writers never stomp the same file.
  - **Why `persist_lock` on top:** a plain `Mutex<()>` serializes the whole
    snapshot-memory → serialize → write sequence, so a racing writer can't
    resurrect a just-removed mapping between the snapshot and the write.
  - **Trade-off:** torn-write safety and correctness at the cost of a file create
    - rename per turn. Given the persist cadence, this is the app's hot disk path —
      which is exactly why it earns the unique-temp treatment.

- **`tasks.json` — fixed temp name + rename.** Task writes are serialized higher up
  by the `TaskManager` event loop and are far less frequent, so a unique name and a
  dedicated lock weren't warranted.

- **`metadata.json` / `agents.json` — direct overwrite.** Low-frequency,
  user-driven edits that accept a small torn-write window for simplicity. A crash
  mid-write can truncate them; boot loading is fault-isolated per entry, so a
  corrupt file hides only that one workspace/definition.

> **Gotcha:** do not assume "all persistence is atomic." Only `threads.json` and
> `tasks.json` are.

---

## 3. In-memory is authoritative; disk is a projection

The central invariant of the whole persistence layer:

> **Invariant:** files are never re-read to _mutate_ state. They are read exactly
> once, on boot, to hydrate memory. From then on the in-memory maps are the source
> of truth and each file is _rebuilt_ from them.

For `threads.json`, the persist path rebuilds the `threads` array under
`persist_lock` by **unioning the live thread map and the dormant map** (live wins
on id collision), and clones the workspace's in-memory usage store into the same
envelope — so mappings and usage are always written together, consistently.

- **Why rebuild instead of read-modify-write:** re-reading disk to edit it would
  race `kill`/`spawn` — a concurrent kill could be undone by a stale read that
  still held the removed mapping. Rebuilding from the authoritative maps under the
  lock makes the write reflect exactly current memory.
- **Invariant (no phantoms):** live threads still mid-handshake (no
  `acp_session_id` yet) are skipped. There is nothing resumable to persist, and a
  null-session mapping would rehydrate as a dead phantom on the next boot.

---

## 4. Schema versioning & v0 back-compat

`threads.json` is the versioned file. Loading does a **two-attempt parse**: try the
v1 object envelope; on failure, fall back to the v0 bare `[ ThreadMapping, … ]`
array (which predates usage) and synthesize an envelope with `schema_version: 0`
and an empty usage store. The _next_ write upgrades it in place, since the writer
always stamps the current version.

- **Field-level back-compat:** newer envelope fields carry serde defaults, so v1
  files written before those fields existed load cleanly with zeros / `None` — no
  migration step needed.
- **Trade-off:** because a genuinely malformed v1 file also fails the first parse,
  it falls through to the v0 parser and surfaces the _v0_ error message. Minor, but
  worth knowing when debugging a corrupt file.

`schema_version` is currently informational — there is no migration table. Forward
evolution rides on serde defaults plus the v0/v1 array-vs-object discriminator.

---

## 5. What is NOT persisted

Some runtime state is deliberately in-memory only and reconstructed after a restart
rather than read from disk:

| State                                                 | How it comes back after boot                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Notification history** (per-thread event log)       | Not restored — starts empty. The frontend re-seeds only currently-running threads via `get_history` replay. |
| **Per-session usage snapshots** (the delta baselines) | Start empty; re-established lazily by the first post-boot usage report per session (Section 7).             |

What **is** persisted, by contrast, is the _aggregate_ usage totals — they live in
`threads.json` and are seeded back on boot. The distinction is deliberate: the
totals survive; the high-water-mark snapshots used to compute deltas do not.

> **Gotcha (resume + empty snapshots):** because the snapshot maps start empty on
> boot, the delta math relies on a resumed agent reporting usage _fresh_ for the
> reloaded session. If an agent instead re-reported cumulatively from the session's
> _original_ start, the first post-boot delta would be measured against a zero
> baseline and could double-count. Emergent does not persist snapshots to defend
> against this; whether it can occur depends on the agent CLI's `LoadSession`
> reporting semantics. Flagged in [known-limitations](./known-limitations.md).

---

## 6. Usage accounting pipeline

Goal: show tokens-used and cost per agent definition per workspace, surviving
restarts. The core difficulty: **ACP reports usage cumulatively per session**, not
per turn, so the pipeline must difference consecutive reports.

```
 agent process (ACP)
        │  resp.usage (per prompt)              SessionUpdate::UsageUpdate (cost)
        ▼                                              ▼
   Notification::TurnUsage  ───┐          ┌── Notification::TokenUsage
   (cumulative tokens)         │          │   (cumulative cost_amount)
                broadcast channel of Notification
                          │
                          ▼
        ThreadManager recorder task (spawned in ThreadManager::new)
          • append to history (any thread_id)
          • TurnUsage: delta = saturating_sub(cumulative, snapshot); apply_turn_delta
          • TokenUsage: cost_delta = cost − snapshot (drop ≤ 0); apply_cost_delta
          • persist threads.json (usage folded in)  ← after every accounted turn/cost
                          │
                          ▼
        usage_stores: HashMap<WorkspaceId, WorkspaceUsageStore>   (in-memory authoritative)
                          │  get_workspace_usage (Tauri cmd)
                          ▼
        frontend usageStore  ── live thread:turn-usage deltas layered on top
```

### 6a. Emission — two notifications, asymmetric payloads

Tokens and cost arrive on **different** notifications, and this asymmetry drives the
recorder's design:

- **`TurnUsage`** (from `acp_bridge.rs` when a prompt turn completes) is
  self-describing: it carries `thread_id`, `workspace_id`, **and**
  `agent_definition_id` alongside the cumulative token counts.
- **`TokenUsage`** (from `handle_session_update` mapping an ACP `UsageUpdate`)
  carries the cumulative `cost_amount` but **no agent/workspace id**.

> **Why the asymmetry matters:** for cost, the recorder must resolve
> `(agent_definition_id, workspace_id, acp_session_id)` from the _live thread
> handle_. It does so with a non-blocking `try_lock` so it never holds the outer
> `threads` `RwLock` while awaiting the inner handle `Mutex`. If the handle is
> already gone (a shutdown race), the cost event is **silently dropped**.

### 6b. Cumulative → delta correction, keyed by ACP session

The recorder keeps a **high-water-mark snapshot per `acp_session_id`** and
subtracts to recover per-turn deltas:

- **Tokens** use per-field `saturating_sub` against the last cumulative snapshot,
  then advance the snapshot to the new values. `saturating_sub` guards against a
  smaller-than-previous report (which would underflow `u64` into a huge wraparound)
  by yielding 0.
- **Cost** uses plain subtraction with a non-positive guard: a zero/negative delta
  means already-accounted, so it is discarded. Currency is **write-once** — set the
  first time an entry gets a non-empty currency, ignored thereafter — with a
  caller-side `"usd"` fallback.

- **Why key by `acp_session_id`, not `thread_id`:** so that killing a thread and
  opening a _new_ ACP session doesn't reuse the old session's high-water mark
  (which would clamp the new session's first delta to zero). The key falls back to
  `thread_id` only when no live handle with a session id is found.
- **`kill_thread` clears both snapshot maps** (by session id, and by thread id as a
  defensive fallback), so a resumed/new session starts fresh from zero rather than
  clamped. This is the deliberate counterpart to keeping the aggregate totals: the
  running totals persist, but the delta baseline is intentionally reset on kill.

### 6c. Aggregation target

`apply_turn_delta` / `apply_cost_delta` upsert an `AgentUsageTotals` **keyed by
`agent_definition_id`** inside the workspace's `WorkspaceUsageStore`. So usage
accumulates _per agent definition per workspace_, folding together every
thread/session that definition ever ran — not per thread. `apply_turn_delta` also
pushes a per-turn record into a bounded `recent_turns` ring buffer (oldest evicted
when full) and stamps a `last_turn_at` recency field.

### 6d. Persistence cadence & boot seeding

The recorder rewrites the whole `threads.json` after **every** applied turn delta
and every **positive** cost delta.

- **Trade-off:** usage is essentially never lost (at most the in-flight turn), at
  the cost of a full `threads.json` rewrite per turn — the reason the hot-path
  unique-temp strategy exists.
- **Boot:** for each workspace, `seed_usage_from_dir` loads the envelope and
  inserts its usage into `usage_stores`, but **only if non-empty**, to avoid
  clobbering with a default. This runs during recovery (see
  [runtime-lifecycle](./runtime-lifecycle.md)) so totals are restored _before_ any
  `get_workspace_usage` can be served. It seeds only the _totals_ — the snapshot
  maps stay empty (Section 5).

### 6e. Frontend path

`get_workspace_usage` (Tauri command) returns the in-memory store clone; the
frontend `usageStore` consumes it. `loadForWorkspace` **wholesale-replaces** the
totals map with the snapshot's `agents` (the store is keyed only by
`agentDefinitionId`, so a workspace switch relies on this replace). Concurrency
guards matter: an `activeLoad` guard discards superseded loads on rapid switching,
and an `eventBuffer` holds live events arriving during the async invoke and replays
them on top so a stale read can't overwrite live data. A separate listener folds
live `thread:turn-usage` events in via `applyDelta`. The real consumer is
`OverviewView.svelte`.

---

## 7. Gotchas (cross-linked to known-limitations)

- **Live cost is not reflected until reload.** The frontend listens only to the
  token event and never touches `costAmount` on live deltas, so cost updates only
  when `loadForWorkspace` re-reads the disk snapshot. Token counts stream live;
  cost lags until a workspace switch/reload.

- **`recent_turns` is written but unused on the frontend.** The ring buffer is
  serialized into `threads.json` and returned by `get_workspace_usage`, but the
  frontend payload interface only declares `agents` — the ring buffer is currently
  dead weight on the wire, reserved for a possible future per-turn UI. (The
  `last_turn_at` recency stamp is parsed and held by the store but not yet
  rendered.)

- **Snapshots start empty on boot** (Section 5) — only the totals are persisted, so
  correct deltas depend on the agent reporting usage fresh for a reloaded session.

- **Not every file is atomic** — `metadata.json` and `agents.json` are direct
  overwrites (Section 2).

See [known-limitations](./known-limitations.md) for all of the above, and
[frontend-architecture](../frontend/frontend-architecture.md) for how `usageStore`
and `OverviewView` render totals. Back to the [docs index](../README.md).
