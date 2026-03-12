export function saveState(workspaceId: string, key: string, value: unknown) {
  try {
    localStorage.setItem(`workspace:${workspaceId}:${key}`, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable in tests
  }
}

export function loadState<T>(workspaceId: string, key: string): T | null {
  try {
    const raw = localStorage.getItem(`workspace:${workspaceId}:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
