import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { parseSkillMeta } from "../skills/parseSkillMeta";

export type SkillProvider = "claude" | "codex";

export type Skill = {
  id: string;
  provider: SkillProvider;
  name: string;
  description: string;
  rootDir: string;
  skillFile: string;
};

type RawSkill = {
  provider: SkillProvider;
  dirName: string;
  rootDir: string;
  skillFile: string;
  content: string;
};

type SkillState = {
  byRepo: Record<string, Skill[]>;
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;
  scanRepository: (repoId: string, repoPath: string) => Promise<void>;
};

export const useSkillStore = create<SkillState>((set, get) => ({
  byRepo: {},
  loading: {},
  errors: {},

  scanRepository: async (repoId, repoPath) => {
    if (get().loading[repoId]) return;

    set((s) => ({
      loading: { ...s.loading, [repoId]: true },
      errors: { ...s.errors, [repoId]: null },
    }));

    try {
      const raw = await invoke<RawSkill[]>("scan_skills", { repoPath });
      const skills: Skill[] = raw.map((r) => {
        const meta = parseSkillMeta(r.content, r.dirName);
        return {
          id: `${r.provider}:${r.rootDir}`,
          provider: r.provider,
          name: meta.name,
          description: meta.description,
          rootDir: r.rootDir,
          skillFile: r.skillFile,
        };
      });
      set((s) => ({
        byRepo: { ...s.byRepo, [repoId]: skills },
        loading: { ...s.loading, [repoId]: false },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => ({
        errors: { ...s.errors, [repoId]: message },
        loading: { ...s.loading, [repoId]: false },
      }));
    }
  },
}));
