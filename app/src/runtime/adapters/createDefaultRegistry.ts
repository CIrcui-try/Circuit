import type { WorkflowSkillProvider } from "../../workflow/schema";
import type { RuntimeBridge } from "../bridge/RuntimeBridge";
import { AdapterRegistry } from "./AdapterRegistry";
import { ClaudeAdapter } from "./ClaudeAdapter";
import { CodexAdapter } from "./CodexAdapter";

export const DEFAULT_PROVIDER_ALLOWLIST: WorkflowSkillProvider[] = [
  "claude",
  "codex",
];

export interface CreateDefaultRegistryDeps {
  bridge: RuntimeBridge;
  allowlist?: WorkflowSkillProvider[] | null;
}

export function createDefaultRegistry(
  deps: CreateDefaultRegistryDeps,
): AdapterRegistry {
  const reg = new AdapterRegistry();
  reg.register(new ClaudeAdapter({ bridge: deps.bridge }));
  reg.register(new CodexAdapter({ bridge: deps.bridge }));
  reg.setAllowlist(
    deps.allowlist === undefined ? DEFAULT_PROVIDER_ALLOWLIST : deps.allowlist,
  );
  return reg;
}
