# Embedded MCP Server, Tools & Token Auth

The embedded MCP server is how a spawned agent calls _back_ into the running Emergent app to coordinate work — creating, listing, updating, and completing tasks, and enumerating the agents it can delegate to. It is an [`rmcp`](https://docs.rs/rmcp) server on an Axum router, bound to loopback, authenticated by a per-thread bearer token, and served inside the Tauri process. No separate daemon, no socket proxy.

> Related reading: [System Overview](system-overview.md) · [Agent Lifecycle & ACP](agent-lifecycle-and-acp.md) · [Task & Swarm Coordination](task-and-swarm-coordination.md) · [Notifications & Protocol](notifications-and-protocol.md) · [Docs index](../README.md)

---

## Where this sits in the system

Emergent runs each agent as a **local host process** — a CLI (Claude Code, Codex, Gemini) launched with piped stdio in its own process group. There is no Docker in this path: no `bollard`, no `docker exec`, no `host.docker.internal`. That single fact is what makes the whole MCP design work; keep it in mind while reading.

Two channels connect the app and each agent:

```
        ACP over piped stdio  (app  -> agent : prompts, session updates)
  app  ─────────────────────────────────────────────────────────►  agent process
        MCP over loopback HTTP (agent -> app  : create/update/complete task, list agents)
       ◄─────────────────────────────────────────────────────────
                    http://127.0.0.1:{port}/mcp   +   Authorization: Bearer <token>
```

ACP is the app driving the agent. MCP is the agent driving the app. This doc is about the second arrow.

**Why a callback server at all?** The task tools are the _real_ inter-agent coordination mechanism in Emergent — not the swarm topology graph, which is UI/bookkeeping only (see [Task & Swarm Coordination](task-and-swarm-coordination.md)). An agent spawns dependent work and reports progress by calling MCP tools; those calls flow straight into the shared `TaskManager` and `AgentManager` with no intermediate process.

Source lives in `crates/emergent-core/src/mcp/`: `http_server.rs` (bind + serve), `handler.rs` (`McpHandler`: the tools and their gating), and `token_registry.rs` (`TokenRegistry`: mint/resolve/revoke bearer tokens).

---

## The HTTP server

`http_server::start` is called once at app boot. It builds a streamable-HTTP `rmcp` service wrapping `McpHandler`, nests it at `/mcp` on an Axum router, binds a `TcpListener` to `127.0.0.1:0` (OS-assigned random port), reads back the actual port, and spawns `axum::serve` as a background task. It returns an `McpHttpServer` handle carrying the bound `port` and a `CancellationToken`.

**Why loopback is safe.** A container model would need `host.docker.internal` or `--network host` wiring, exposing the endpoint across the container boundary. Here agents are ordinary host processes, so `127.0.0.1` is reachable by them and _only_ by them — no other machine can hit the port. This is the first of three defensive layers (loopback + random port + bearer token); an attacker would already have to be running code on this host _and_ know a live token.

> **Invariant:** the server binds `127.0.0.1` only. Never change this to `0.0.0.0` — the auth model assumes no remote reachability, and tokens have no expiry (see below).

**Why a fresh `McpHandler` per connection.** The service factory closure builds a new handler for each connection. That is nearly free — the handler holds only cheap `Arc` clones of `AgentManager`, `TokenRegistry`, and `TaskManager` plus its `ToolRouter` — and it keeps zero per-connection state. All authoritative state lives behind the shared `Arc`s.

**Why stateless + JSON responses** (`stateful_mode: false`, `json_response: true`, no SSE keep-alive). Every MCP call is self-contained and self-authenticating: the bearer token rides on each request, so there is no MCP session to persist or resume, and plain JSON suffices over an SSE stream.

> **Trade-off:** stateless means the token is re-validated on _every_ request (an `RwLock` read + `HashMap` lookup). That is trivially cheap and buys a server that needs no per-client teardown and survives client reconnects for free.

**Shutdown.** The handle's `CancellationToken` drives `with_graceful_shutdown`; cancelling it stops the server. In practice the handle is `app.manage`'d into Tauri state and the process simply exits at quit — nothing inside the `mcp` module ever calls `.cancel()`, so the server usually just dies with the process.

> **Gotcha:** MCP server start failure is **non-fatal**. If the bind fails, boot logs the error and the app runs on without a callback endpoint. Agents can still chat over ACP; they just cannot use task tools.

---

## Startup wiring & the port handshake

Boot order matters. A single `Arc<TokenRegistry>` is created first and threaded through `AgentManager`, `McpHandler`, and the HTTP server; then the server binds and its port is written into `ThreadManager`'s `mcp_port` (an `AtomicU16`) via `set_mcp_port` — **before** any persisted task sessions are resumed.

**Why the port is set before task resume.** A resumed agent is handed the live port instead of the default `0`. Reverse the order and resumed agents would try to reach `http://127.0.0.1:0/mcp` and never connect.

> **Invariant:** minting (in `ThreadManager`) and resolving (in `McpHandler`) must see the same token map — so they must share the _same_ `Arc<TokenRegistry>`, not copies.

---

## The tools

All tools live in one `#[tool_router] impl McpHandler` block. Each reads the bearer token from the raw HTTP request parts to identify its caller; results come back as pretty-printed JSON in a single text content. Two visibility classes:

| Tool            | Purpose                                                                                                | Session type |
| --------------- | ------------------------------------------------------------------------------------------------------ | ------------ |
| `create_task`   | Spawn dependent work assigned to an agent; optionally subscribe to its updates. Returns `{ task_id }`. | any          |
| `list_tasks`    | List the caller-workspace's tasks, optionally filtered by status/agent.                                | any          |
| `list_agents`   | Enumerate agent definitions available for delegation in the caller's workspace.                        | any          |
| `update_task`   | Post a progress message routed to the task's creator.                                                  | task-only    |
| `complete_task` | Mark the current task done with an optional summary.                                                   | task-only    |

**How a call is scoped.** Every tool first resolves the bearer token to a `thread_id`. The workspace-scoped tools (`create_task`, `list_tasks`, `list_agents`) then resolve that thread to a `workspace_id` and operate within it. The task-only tools (`update_task`, `complete_task`) instead resolve the caller's own `task_id` and act on that task directly — they never resolve a workspace.

**`create_task` can spawn an agent.** A task with no blockers starts immediately, which spawns a fresh agent thread for the assignee; a task with blockers stays pending until its blockers complete. The caller only gets `{ task_id }` back — the spawn is asynchronous relative to the tool return. The caller's own `task_id` (if it is a task session) becomes the new task's parent, forming a task tree, and `subscribe` registers the _caller's thread_ to receive lifecycle notifications. Registration happens _before_ the task starts, so the "started" notification is not lost for no-blocker tasks that start synchronously.

**`complete_task` tears down its own thread — deferred, not immediate.** The agent is mid-turn when it calls `complete_task` (it is calling a tool _during_ a turn). Phase 1, synchronous inside the call, marks the task completed, blocks further prompts, notifies subscribers, and starts anything that was blocked on it. Phase 2 waits for the current ACP turn to drain (`PromptComplete`) before actually shutting the thread down.

> **Why deferred teardown:** tearing the thread down immediately would sever the in-flight ACP turn mid-stream. The path is idempotent (teardown fires at most once) and a completed task's thread is _demoted to a resumable dormant stub_, not purged — it can be resumed later. Full details live in [Task & Swarm Coordination](task-and-swarm-coordination.md).

> **Gotcha:** `list_tasks` rejects an unknown `status` string with an `invalid_params` error, distinct from the generic `internal_error` used elsewhere. Valid values: `pending` / `working` / `completed` / `failed`.

> **Gotcha:** `list_agents` returns _all_ agent definitions in the workspace. It is **not** filtered by swarm topology — topology edges do not gate who an agent can see or delegate to. Treat topology as decorative for coordination.

> **Invariant:** `update_task` and `complete_task` require the task to be in `Working` state; both surface a JSON-RPC error on a non-working or unknown task.

`get_info` advertises only the tools capability. No resources or prompts are exposed.

---

## Bearer-token auth

The credential in this path is a per-thread bearer token — no passwords, API keys, or mTLS. `TokenRegistry` is an in-memory `RwLock<HashMap>` mapping each token to a `TokenEntry` holding the owning `thread_id` and an `Option<task_id>` that is `Some` iff the token was minted for a task session. It supports mint (`register`), thread lookup (`resolve`), task-id lookup (`resolve_task_id`), and revoke-all-for-thread (`revoke_agent`). Tokens are 64 hex chars from 32 cryptographically random bytes.

### Mint before spawn, and why `task_id` is captured at mint time

`ThreadManager` mints the token **synchronously, before the agent subprocess is spawned**, and bakes the `task_id` into the entry at that moment.

**Why bake in `task_id` rather than look it up live?** During the ACP handshake the agent calls `list_tools` (see gating below) _before_ the `ThreadHandle` has been inserted into `ThreadManager`'s live thread map. A live-map lookup would race and usually find nothing. Because the `task_id` is recorded at mint time, `resolve_task_id` can answer "is this a task session?" from the registry alone, independent of the async handle insertion.

```
register(thread_id, task_id)      // token + task_id recorded NOW (pre-spawn, synchronous)
   └─► spawn agent process
          └─► ACP handshake: list_tools  ── needs task_id ──►  resolve_task_id(token)  ✔ already present
                 └─► ThreadHandle inserted into live map  (happens later)
```

### Resolve on every request

Each tool call reads the `Authorization` header, strips the `Bearer ` prefix, and resolves the token. A missing/garbled header and an unknown token each map to a distinct JSON-RPC error.

> **Naming gotcha:** the resolver is named `agent_id_from_parts` but returns a **`thread_id`** — a token maps to a _thread_. The `agent_id` naming is legacy vocabulary; there is no separate agent-id credential here.

### Revoke on teardown, no expiry

Tokens are revoked on **every** teardown path — graceful shutdown (including task-completion teardown), kill, and failed spawn/resume cleanup. Even a thread demoted to a dormant stub has its token revoked; on resume it is issued a **freshly minted** one. Tokens have **no TTL and no rotation** — valid from mint until their thread's teardown.

> **Why no expiry is acceptable:** the attack surface is already "code running on this host that also knows a live 64-hex token." A token's lifetime is bounded by its thread's lifetime, and the registry is purely in-memory — nothing on disk, nothing survives a restart. Expiry would buy little and complicate long-running task sessions. Every restart invalidates all tokens, which is fine since agent processes don't survive a restart either.

---

## Task-only tool gating (the asymmetry)

`update_task` and `complete_task` are task-only, and the gate is enforced in two places that behave differently — intentionally:

**1. Visibility — `list_tools` filters.** A conversation session simply never _sees_ the task-only tools in its advertised list. The filter calls `is_task_session`, which consults `resolve_task_id` on the registry (not the live map, because `list_tools` runs during the handshake).

**2. Execution — `call_tool` guards.** `call_tool` does not re-apply the filter. Instead each task-only tool body resolves the caller's `task_id` via the live thread state and fails with `"This session is not a task session"` when there is none.

> **Gotcha (the asymmetry):** a well-behaved client that respects `list_tools` never offers these tools to a conversation session. A client that calls `complete_task` anyway does **not** silently succeed — it gets a JSON-RPC error. Visibility is _filtered_; execution is _guarded_. Both agree conversation sessions can't complete tasks, but via different code paths — and different sources (mint-time task id vs. live thread state). They agree in the current design because a session's task association never changes after mint.

---

## Injecting the URL + token into the ACP session

The agent learns the endpoint and credential through its **ACP session config**, not the environment. During the handshake (`agent/lifecycle.rs`), an HTTP MCP server config named `emergent-swarm` is built pointing at `http://127.0.0.1:{mcp_port}/mcp` with an `Authorization: Bearer <token>` header, and attached to both `NewSessionRequest.mcp_servers` (fresh sessions) and `LoadSessionRequest.mcp_servers` (resumed sessions). The port comes from `ThreadManager`'s `AtomicU16`; the token is the one just minted by `register`. The ACP agent then connects to that URL with that header on every MCP request.

> **Invariant:** every ACP session gets exactly one MCP server config, pointing at loopback, carrying its own thread's token. Two threads never share a token.

See [Agent Lifecycle & ACP](agent-lifecycle-and-acp.md) for the full spawn/handshake sequence.

---

## Error semantics: HTTP 200 with a JSON-RPC error

MCP tool errors do **not** produce non-2xx HTTP responses. A failed tool call returns **HTTP 200** with the error embedded in the JSON-RPC body (as `ErrorData`) — `internal_error` in most cases, `invalid_params` for the bad-`status` case in `list_tasks`.

> **Gotcha:** do not gate MCP client logic on HTTP status codes. "Thread not found", "Invalid bearer token", "This session is not a task session", and validation failures all come back as `200 OK` with an error object in the payload. The transport succeeded; the _call_ failed. This is standard JSON-RPC-over-HTTP, but it surprises people expecting `401`/`400`.

---

## Persistence

None. `TokenRegistry` is a pure in-memory `RwLock<HashMap>` and the streamable-HTTP server is stateless. Nothing about MCP is written to disk; tokens vanish on revoke or process exit. Task _data_ is persisted by `TaskManager` (`tasks.json`), not by this subsystem — see [Persistence & Usage](persistence-and-usage.md).

---

## Quick reference

- **Bind:** `127.0.0.1:0` (random port), path `/mcp`, background `tokio` task.
- **Auth:** `Authorization: Bearer <64-hex>`, resolved per request via `TokenRegistry`.
- **Tools:** `create_task`, `list_tasks`, `list_agents` (any session); `update_task`, `complete_task` (task sessions only).
- **Config:** stateless, JSON responses, no SSE keep-alive.
- **Errors:** HTTP 200 + JSON-RPC error body.

---

_See also: [Docs index](../README.md) · [Task & Swarm Coordination](task-and-swarm-coordination.md) · [Agent Lifecycle & ACP](agent-lifecycle-and-acp.md) · [Notifications & Protocol](notifications-and-protocol.md) · [Known Limitations](known-limitations.md)_
