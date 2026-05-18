import type { CliResolveResult, RuntimeBridge } from "./RuntimeBridge";
import {
  loadCliSettings,
  manualPathForCommand,
} from "../../stores/cliSettingsStore";

export interface ResolvedCliCommand {
  command: string;
  resolve?: CliResolveResult;
}

export async function resolveCliCommand(
  bridge: RuntimeBridge,
  command: string,
): Promise<ResolvedCliCommand> {
  if (!bridge.resolveCli || !isCliCommand(command)) {
    return { command };
  }
  const settings = await loadCliSettings();
  const resolve = await bridge.resolveCli(
    command,
    manualPathForCommand(settings, command) ?? null,
  );
  if (resolve.ok && resolve.resolvedPath) {
    return { command: resolve.resolvedPath, resolve };
  }
  return { command, resolve };
}

export function cliResolveError(resolve: CliResolveResult): string {
  return resolve.errorMessage ?? `${resolve.command} could not be resolved`;
}

function isCliCommand(command: string): boolean {
  return command === "claude" || command === "codex";
}
