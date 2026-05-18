import { getHostBridge, type CliSettingsDTO } from "../host/bridge";

let cachedSettings: CliSettingsDTO | null = null;
let hasLoaded = false;
let loadPromise: Promise<CliSettingsDTO> | null = null;

export async function loadCliSettings(): Promise<CliSettingsDTO> {
  if (hasLoaded) return cachedSettings ?? {};
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const bridge = getHostBridge();
      cachedSettings = (await bridge.loadCliSettings?.()) ?? {};
    } catch {
      cachedSettings = {};
    }
    hasLoaded = true;
    loadPromise = null;
    return cachedSettings;
  })();
  return loadPromise;
}

export async function saveCliSettings(settings: CliSettingsDTO): Promise<void> {
  const normalized = normalizeCliSettings(settings);
  cachedSettings = normalized;
  hasLoaded = true;
  loadPromise = null;
  const bridge = getHostBridge();
  await bridge.saveCliSettings?.(normalized);
}

export function manualPathForCommand(
  settings: CliSettingsDTO,
  command: string,
): string | undefined {
  if (command === "claude") return settings.claudePath;
  if (command === "codex") return settings.codexPath;
  return undefined;
}

export function setManualPath(
  settings: CliSettingsDTO,
  command: string,
  path: string | undefined,
): CliSettingsDTO {
  const next = { ...settings };
  const value = path?.trim() || undefined;
  if (command === "claude") {
    next.claudePath = value;
  } else if (command === "codex") {
    next.codexPath = value;
  }
  return normalizeCliSettings(next);
}

export function resetCliSettingsCacheForTest(): void {
  cachedSettings = null;
  hasLoaded = false;
  loadPromise = null;
}

function normalizeCliSettings(settings: CliSettingsDTO): CliSettingsDTO {
  return {
    ...(settings.claudePath?.trim()
      ? { claudePath: settings.claudePath.trim() }
      : {}),
    ...(settings.codexPath?.trim()
      ? { codexPath: settings.codexPath.trim() }
      : {}),
  };
}
