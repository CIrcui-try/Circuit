import type { WorkflowSkillProvider } from "../../workflow/schema";
import type { AgentAdapter } from "./AgentAdapter";

export class UnknownProviderError extends Error {
  constructor(public readonly provider: string) {
    super(`No adapter registered for provider "${provider}"`);
    this.name = "UnknownProviderError";
  }
}

export class ProviderNotAllowedError extends Error {
  constructor(
    public readonly provider: string,
    public readonly allowlist: WorkflowSkillProvider[],
  ) {
    super(
      `Provider "${provider}" is not in the allowlist: [${allowlist.join(
        ", ",
      )}]`,
    );
    this.name = "ProviderNotAllowedError";
  }
}

export class AdapterRegistry {
  private readonly adapters = new Map<WorkflowSkillProvider, AgentAdapter>();
  private allowlist: WorkflowSkillProvider[] | null = null;

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  setAllowlist(list: WorkflowSkillProvider[] | null): void {
    this.allowlist = list ? [...list] : null;
  }

  getAllowlist(): WorkflowSkillProvider[] | null {
    return this.allowlist ? [...this.allowlist] : null;
  }

  isAllowed(provider: WorkflowSkillProvider): boolean {
    if (!this.allowlist) return true;
    return this.allowlist.includes(provider);
  }

  get(provider: WorkflowSkillProvider): AgentAdapter {
    if (this.allowlist && !this.allowlist.includes(provider)) {
      throw new ProviderNotAllowedError(provider, this.allowlist);
    }
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
