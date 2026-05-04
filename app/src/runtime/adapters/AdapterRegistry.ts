import type { WorkflowSkillProvider } from "../../workflow/schema";
import type { AgentAdapter } from "./AgentAdapter";

export class UnknownProviderError extends Error {
  constructor(public readonly provider: string) {
    super(`No adapter registered for provider "${provider}"`);
    this.name = "UnknownProviderError";
  }
}

export class AdapterRegistry {
  private readonly adapters = new Map<WorkflowSkillProvider, AgentAdapter>();

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  get(provider: WorkflowSkillProvider): AgentAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new UnknownProviderError(provider);
    return adapter;
  }

  has(provider: WorkflowSkillProvider): boolean {
    return this.adapters.has(provider);
  }

  list(): WorkflowSkillProvider[] {
    return [...this.adapters.keys()];
  }
}
