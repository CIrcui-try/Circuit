const STORAGE_PREFIX = "circuit.starterFlowPrompt.";

export function markStarterFlowPromptPending(repositoryId: string): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(storageKey(repositoryId), "pending");
  } catch {
    // Starter flow prompting is best effort.
  }
}

export function consumeStarterFlowPrompt(repositoryId: string): boolean {
  const storage = getStorage();
  if (!storage) return false;

  try {
    const pending = storage.getItem(storageKey(repositoryId)) === "pending";
    if (pending) storage.removeItem(storageKey(repositoryId));
    return pending;
  } catch {
    return false;
  }
}

function storageKey(repositoryId: string): string {
  return `${STORAGE_PREFIX}${repositoryId}`;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage ?? null;
}
