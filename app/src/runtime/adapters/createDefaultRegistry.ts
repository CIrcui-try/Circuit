import type { RuntimeBridge } from "../bridge/RuntimeBridge";
import { AdapterRegistry } from "./AdapterRegistry";
import { ClaudeAdapter } from "./ClaudeAdapter";
import { CodexAdapter } from "./CodexAdapter";

export interface CreateDefaultRegistryDeps {
  bridge: RuntimeBridge;
}

export function createDefaultRegistry(
  deps: CreateDefaultRegistryDeps,
): AdapterRegistry {
  const reg = new AdapterRegistry();
  reg.register(new ClaudeAdapter({ bridge: deps.bridge }));
  reg.register(new CodexAdapter({ bridge: deps.bridge }));
  return reg;
}
