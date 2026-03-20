# Multi-Agent Type Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to choose between Claude Code and Codex when adding agents to a swarm, via an inline popover anchored to the "+" button.

**Architecture:** Add Codex to the known agents list in Rust. Introduce a new `known_agents` Tauri command that returns all known agent types (with an `available` flag based on detection), so the frontend can show unavailable agents greyed out. Replace the auto-spawn on swarm creation with an empty swarm. Build an `AgentPickerPopover` Svelte component for the selection UI. Update agent naming to use the agent type name with deduplication numbering.

**Tech Stack:** Rust (detect.rs, commands.rs), Svelte 5, TypeScript, Tailwind CSS 4

---

### Task 1: Add Codex to known agents and new `known_agents` command (Rust)

**Files:**

- Modify: `src-tauri/src/detect.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

Currently `detect_agents()` only returns agents found on the system. The popover needs all known agents with an `available` boolean so unavailable ones render greyed out.

- [ ] **Step 1: Add `KnownAgent` struct and `known_agents()` function to detect.rs**

Add a new struct and function. **Important:** update the existing `KNOWN_AGENTS` const (line 11) to include Codex — both `detect_agents()` and `known_agents()` share this same const:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct KnownAgent {
    pub name: String,
    pub binary: String,
    pub available: bool,
}

// Update the existing const (line 11) — do NOT create a second one:
const KNOWN_AGENTS: &[(&str, &str)] = &[
    ("Claude Code", "claude-agent-acp"),
    ("Codex", "codex-acp"),
];

/// Return all known agent types, marking which are installed.
pub fn known_agents() -> Vec<KnownAgent> {
    KNOWN_AGENTS
        .iter()
        .map(|&(name, binary)| KnownAgent {
            name: name.to_string(),
            binary: binary.to_string(),
            available: which::which(binary).is_ok(),
        })
        .collect()
}
```

- [ ] **Step 2: Add Rust tests for known_agents**

Add to the existing `#[cfg(test)]` block in `detect.rs`:

```rust
#[test]
fn known_agents_returns_all() {
    let agents = known_agents();
    assert_eq!(agents.len(), KNOWN_AGENTS.len());
    assert_eq!(agents[0].name, "Claude Code");
    assert_eq!(agents[0].binary, "claude-agent-acp");
    assert_eq!(agents[1].name, "Codex");
    assert_eq!(agents[1].binary, "codex-acp");
}

#[test]
fn known_agent_serializes() {
    let agent = KnownAgent {
        name: "Test".into(),
        binary: "test-bin".into(),
        available: true,
    };
    let json = serde_json::to_string(&agent).unwrap();
    assert!(json.contains("\"available\":true"));
}
```

- [ ] **Step 3: Run Rust tests**

Run: `cd src-tauri && cargo test`
Expected: All tests pass, including the two new ones.

- [ ] **Step 4: Add `known_agents` Tauri command**

In `src-tauri/src/commands.rs`, add:

```rust
#[tauri::command]
pub async fn known_agents() -> Result<Vec<detect::KnownAgent>, String> {
    Ok(detect::known_agents())
}
```

Register it in `src-tauri/src/lib.rs` — find the `invoke_handler` macro call and add `commands::known_agents` to the list.

- [ ] **Step 5: Run Rust lint**

Run: `bun run lint:rust`
Expected: No warnings or errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/detect.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add Codex to known agents, add known_agents command"
```

---

### Task 2: Expose known agents to the frontend store

**Files:**

- Modify: `src/stores/app-state.svelte.ts`

The frontend needs to call `known_agents` instead of (or in addition to) `detect_agents` so the popover can show all agent types.

- [ ] **Step 1: Add `knownAgents` state and fetch in `initialize()`**

In `app-state.svelte.ts`, add a new state variable and type:

```typescript
interface KnownAgent {
  name: string;
  binary: string;
  available: boolean;
}
```

Add state: `let knownAgents = $state<KnownAgent[]>([]);`

In `initialize()`, after the existing `detectAgents` call, add:

```typescript
const known = await invoke<KnownAgent[]>("known_agents");
knownAgents = known;
```

Import `invoke` from `@tauri-apps/api/core` at the top of the file (it's already imported in agents.svelte.ts but not here — check if it's needed or if it goes through `agentStore`).

- [ ] **Step 2: Expose `knownAgents` as a getter on the returned object**

Add to the return object:

```typescript
get knownAgents() {
  return knownAgents;
},
```

- [ ] **Step 3: Remove auto-spawn from `newSwarm()`**

Change `newSwarm()` to remove the auto-spawn logic. Replace lines 58-70 with:

```typescript
async function newSwarm(): Promise<void> {
  if (demoMode) return;

  const selected = await open({ directory: true, multiple: false });
  if (!selected) return;

  const path = selected as string;
  const name = path.split("/").pop() || path;
  createSwarm(name, path);
}
```

Note: remove the `availableAgents.length === 0` guard — empty swarms are now valid. The guard for "no agents available" moves to the popover UI (greyed-out items).

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/stores/app-state.svelte.ts
git commit -m "feat: expose known agents to frontend, remove auto-spawn from newSwarm"
```

---

### Task 3: Build the AgentPickerPopover component

**Files:**

- Create: `src/components/AgentPickerPopover.svelte`
- Create: `src/components/AgentPickerPopover.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/AgentPickerPopover.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import AgentPickerPopover from "./AgentPickerPopover.svelte";

interface KnownAgent {
  name: string;
  binary: string;
  available: boolean;
}

const agents: KnownAgent[] = [
  { name: "Claude Code", binary: "claude-agent-acp", available: true },
  { name: "Codex", binary: "codex-acp", available: false },
];

function renderPopover(
  overrides: Partial<{
    agents: KnownAgent[];
    onSelect: (binary: string) => void;
    onClose: () => void;
  }> = {},
) {
  return render(AgentPickerPopover, {
    props: {
      agents: overrides.agents ?? agents,
      onSelect: overrides.onSelect ?? (() => {}),
      onClose: overrides.onClose ?? (() => {}),
    },
  });
}

describe("AgentPickerPopover", () => {
  it("renders all agent names", () => {
    renderPopover();
    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
  });

  it("renders binary names", () => {
    renderPopover();
    expect(screen.getByText("claude-agent-acp")).toBeTruthy();
    expect(screen.getByText("codex-acp")).toBeTruthy();
  });

  it("calls onSelect with binary when clicking available agent", async () => {
    const onSelect = vi.fn();
    renderPopover({ onSelect });
    await fireEvent.click(screen.getByText("Claude Code"));
    expect(onSelect).toHaveBeenCalledWith("claude-agent-acp");
  });

  it("does not call onSelect when clicking unavailable agent", async () => {
    const onSelect = vi.fn();
    renderPopover({ onSelect });
    await fireEvent.click(screen.getByText("Codex"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks unavailable agents with disabled styling", () => {
    renderPopover();
    const codexItem = screen.getByText("Codex").closest("[data-agent]");
    expect(codexItem?.getAttribute("data-available")).toBe("false");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- --run src/components/AgentPickerPopover.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement AgentPickerPopover.svelte**

Create `src/components/AgentPickerPopover.svelte`:

```svelte
<!-- src/components/AgentPickerPopover.svelte -->
<script lang="ts">
  interface KnownAgent {
    name: string;
    binary: string;
    available: boolean;
  }

  interface Props {
    agents: KnownAgent[];
    onSelect: (binary: string) => void;
    onClose: () => void;
  }

  let { agents, onSelect, onClose }: Props = $props();

  function handleClick(agent: KnownAgent) {
    if (!agent.available) return;
    onSelect(agent.binary);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop to catch outside clicks -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-40"
  onclick={onClose}
  onkeydown={handleKeydown}
></div>

<div
  class="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border border-border-strong bg-bg-base shadow-lg"
  role="menu"
>
  <div
    class="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted"
  >
    Add agent
  </div>
  {#each agents as agent (agent.binary)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="flex items-center gap-2 mx-1.5 mb-1 px-2 py-1.5 rounded-md
        {agent.available
        ? 'cursor-default hover:bg-bg-hover'
        : 'opacity-40 cursor-not-allowed'}"
      role="menuitem"
      data-agent={agent.binary}
      data-available={String(agent.available)}
      onclick={() => handleClick(agent)}
    >
      <div
        class="flex items-center justify-center w-[22px] h-[22px] rounded-md text-[11px] font-semibold shrink-0
          {agent.binary === 'claude-agent-acp'
          ? 'bg-[#e8ddd0] text-accent'
          : 'bg-[#d4e4d9] text-[#2d6e46]'}"
      >
        {agent.binary === "claude-agent-acp" ? "C" : "X"}
      </div>
      <div class="min-w-0">
        <div class="text-[12px] font-medium text-fg-heading truncate">
          {agent.name}
        </div>
        <div
          class="text-[10px] text-fg-muted font-[family-name:var(--font-mono)] truncate"
        >
          {agent.binary}
        </div>
      </div>
    </div>
  {/each}
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- --run src/components/AgentPickerPopover.test.ts`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/AgentPickerPopover.svelte src/components/AgentPickerPopover.test.ts
git commit -m "feat: add AgentPickerPopover component"
```

---

### Task 4: Integrate popover into Sidebar

**Files:**

- Modify: `src/components/Sidebar.svelte`
- Modify: `src/components/Sidebar.test.ts`

- [ ] **Step 1: Update Sidebar props**

Replace the `onAddAgent` prop with `knownAgents` and `onAddAgent` that takes a binary:

```typescript
interface Props {
  swarms: DisplaySwarm[];
  selectedAgentId: string | null;
  demoMode: boolean;
  knownAgents: { name: string; binary: string; available: boolean }[];
  onSelectAgent: (id: string) => void;
  onToggleSwarm: (id: string) => void;
  onNewSwarm: () => void;
  onAddAgent: (swarmId: string, agentBinary: string) => void;
}
```

- [ ] **Step 2: Add popover state and integrate component**

Add state for which swarm's popover is open:

```typescript
let pickerSwarmId = $state<string | null>(null);
```

Import `AgentPickerPopover` at the top. Replace the existing "+" button section (lines 57-65) with:

```svelte
{#if !demoMode}
  <div class="relative">
    <button
      class="interactive flex items-center justify-center w-5 h-5 mr-2 text-fg-muted rounded hover:text-fg-default"
      onclick={() => {
        pickerSwarmId = pickerSwarmId === swarm.id ? null : swarm.id;
      }}
      title="Add agent"
    >
      <Plus size={10} />
    </button>
    {#if pickerSwarmId === swarm.id}
      <AgentPickerPopover
        agents={knownAgents}
        onSelect={(binary) => {
          onAddAgent(swarm.id, binary);
          pickerSwarmId = null;
        }}
        onClose={() => {
          pickerSwarmId = null;
        }}
      />
    {/if}
  </div>
{/if}
```

- [ ] **Step 3: Update Sidebar tests**

In `Sidebar.test.ts`, update the `SidebarOverrides` interface and `renderSidebar` to include `knownAgents`:

```typescript
interface SidebarOverrides {
  swarms?: DisplaySwarm[];
  selectedAgentId?: string | null;
  demoMode?: boolean;
  knownAgents?: { name: string; binary: string; available: boolean }[];
  onSelectAgent?: (id: string) => void;
  onToggleSwarm?: (id: string) => void;
  onNewSwarm?: () => void;
  onAddAgent?: (swarmId: string, agentBinary: string) => void;
}

function renderSidebar(overrides: SidebarOverrides = {}) {
  return render(Sidebar, {
    props: {
      swarms: overrides.swarms ?? [makeSwarm()],
      selectedAgentId: overrides.selectedAgentId ?? null,
      demoMode: overrides.demoMode ?? true,
      knownAgents: overrides.knownAgents ?? [
        { name: "Claude Code", binary: "claude-agent-acp", available: true },
        { name: "Codex", binary: "codex-acp", available: true },
      ],
      onSelectAgent: overrides.onSelectAgent ?? noop,
      onToggleSwarm: overrides.onToggleSwarm ?? noop,
      onNewSwarm: overrides.onNewSwarm ?? noop,
      onAddAgent: overrides.onAddAgent ?? noop,
    },
  });
}
```

Add a new test:

```typescript
it("shows agent picker popover when clicking add button", async () => {
  renderSidebar({ demoMode: false });
  const addButton = screen.getByTitle("Add agent");
  await fireEvent.click(addButton);
  expect(screen.getByText("Add agent")).toBeTruthy();
  expect(screen.getByText("Claude Code")).toBeTruthy();
  expect(screen.getByText("Codex")).toBeTruthy();
});
```

- [ ] **Step 4: Run all Sidebar tests**

Run: `bun run test -- --run src/components/Sidebar.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.svelte src/components/Sidebar.test.ts
git commit -m "feat: integrate agent picker popover into Sidebar"
```

---

### Task 5: Wire up App.svelte and update agent naming

**Files:**

- Modify: `src/App.svelte`
- Modify: `src/stores/agents.svelte.ts`

- [ ] **Step 1: Update App.svelte to pass knownAgents and new onAddAgent signature**

In `App.svelte`, update the Sidebar usage:

```svelte
<Sidebar
  swarms={appState.swarms}
  selectedAgentId={appState.selectedAgentId}
  demoMode={appState.demoMode}
  knownAgents={appState.knownAgents}
  onSelectAgent={(id) => (appState.selectedAgentId = id)}
  onToggleSwarm={(id) => appState.toggleSwarmCollapsed(id)}
  onNewSwarm={() => appState.newSwarm()}
  onAddAgent={(swarmId, agentBinary) => {
    appState.addAgentToSwarm(swarmId, agentBinary);
  }}
/>
```

- [ ] **Step 2: Update agent naming in `toDisplayAgent`**

In `agents.svelte.ts`, update `toDisplayAgent` to derive the display name from the `cli` field. The name should be the agent type name, with a number appended only when there are duplicates of the same type in the same swarm.

Replace the `name: conn.cli` line in `toDisplayAgent`:

```typescript
function toDisplayAgent(conn: AgentConnection): DisplayAgent {
  const lastMsg = conn.messages.at(-1);
  const statusMap: Record<AgentConnection["status"], DisplayAgent["status"]> = {
    initializing: "working",
    idle: "idle",
    working: "working",
    error: "error",
  };
  return {
    id: conn.id,
    swarmId: conn.swarmId,
    name: getAgentDisplayName(conn),
    status: statusMap[conn.status],
    preview: lastMsg?.content ? lastMsg.content.slice(0, 30) + "..." : "",
    updatedAt: "just now",
    messages: conn.messages,
  };
}
```

Add the naming helper:

```typescript
const CLI_DISPLAY_NAMES: Record<string, string> = {
  "claude-agent-acp": "Claude Code",
  "codex-acp": "Codex",
};

function getAgentDisplayName(conn: AgentConnection): string {
  const typeName = CLI_DISPLAY_NAMES[conn.cli] ?? conn.cli;

  // Count how many agents of the same type exist in the same swarm
  const siblings = Object.values(agents).filter(
    (a) => a.swarmId === conn.swarmId && a.cli === conn.cli,
  );

  if (siblings.length <= 1) return typeName;

  // Assign a stable sequential number based on insertion order
  const index = siblings.findIndex((a) => a.id === conn.id);
  return `${typeName} #${index + 1}`;
}
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 4: Run all tests**

Run: `bun run test -- --run`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.svelte src/stores/agents.svelte.ts
git commit -m "feat: wire up agent picker, add type-based agent naming"
```

---

### Task 6: Full pre-commit checks

**Files:** None (verification only)

- [ ] **Step 1: Run lint**

Run: `bun run lint`
Expected: No errors.

- [ ] **Step 2: Run Rust lint**

Run: `bun run lint:rust`
Expected: No errors or warnings.

- [ ] **Step 3: Run format check**

Run: `bun run fmt:check`
Expected: No formatting issues. If there are, run `bun run fmt` to fix.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 5: Run all tests**

Run: `bun run test -- --run && bun run test:rust`
Expected: All tests pass.
