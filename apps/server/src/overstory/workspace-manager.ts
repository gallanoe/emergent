import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Workspace, WorkspaceStatus } from "@emergent/contracts";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(os.homedir(), ".emergent", "userdata");
const WORKSPACES_FILE = path.join(DATA_DIR, "workspaces.json");

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

interface StoredWorkspace {
  id: string;
  name: string;
  path: string;
  overstoryPath: string;
  active: boolean;
  status: WorkspaceStatus;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadWorkspaces(): StoredWorkspace[] {
  ensureDataDir();
  if (!fs.existsSync(WORKSPACES_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(WORKSPACES_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StoredWorkspace[];
  } catch {
    return [];
  }
}

export function saveWorkspaces(workspaces: StoredWorkspace[]): void {
  ensureDataDir();
  fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(workspaces, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export function addWorkspace(workspacePath: string): StoredWorkspace {
  const absPath = path.resolve(workspacePath);
  const overstoryPath = path.join(absPath, ".overstory");

  if (!fs.existsSync(overstoryPath) || !fs.statSync(overstoryPath).isDirectory()) {
    throw new Error(
      `No .overstory directory found at ${overstoryPath}. Is this an Overstory workspace?`,
    );
  }

  const workspaces = loadWorkspaces();

  // Prevent duplicate paths
  const existing = workspaces.find((w) => w.path === absPath);
  if (existing) {
    return existing;
  }

  const workspace: StoredWorkspace = {
    id: crypto.randomUUID(),
    name: path.basename(absPath),
    path: absPath,
    overstoryPath,
    active: workspaces.length === 0, // first added workspace becomes active
    status: "disconnected",
  };

  workspaces.push(workspace);
  saveWorkspaces(workspaces);
  return workspace;
}

export function removeWorkspace(id: string): void {
  const workspaces = loadWorkspaces();
  const filtered = workspaces.filter((w) => w.id !== id);
  if (filtered.length === workspaces.length) {
    throw new Error(`Workspace with id "${id}" not found`);
  }
  saveWorkspaces(filtered);
}

export function setActiveWorkspace(id: string): StoredWorkspace {
  const workspaces = loadWorkspaces();
  let found: StoredWorkspace | undefined;

  for (const w of workspaces) {
    if (w.id === id) {
      w.active = true;
      w.status = "connected";
      found = w;
    } else {
      w.active = false;
    }
  }

  if (!found) {
    throw new Error(`Workspace with id "${id}" not found`);
  }

  saveWorkspaces(workspaces);
  return found;
}

export function getActiveWorkspace(): StoredWorkspace | null {
  const workspaces = loadWorkspaces();
  return workspaces.find((w) => w.active) ?? null;
}
