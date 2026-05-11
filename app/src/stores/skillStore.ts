import { create } from "zustand";
import { getHostBridge } from "../host/bridge";
import type { SkillInputHint } from "../host/bridge";
import { parseSkillMeta } from "../skills/parseSkillMeta";

export type SkillProvider = "claude" | "codex";
export type SkillSource = "repository" | "default" | "system";

export type Skill = {
  id: string;
  provider: SkillProvider;
  source?: SkillSource;
  name: string;
  description: string;
  inputHints?: SkillInputHint[];
  rootDir: string;
  skillFile: string;
  skillFileAbsPath?: string;
  systemSkillId?: string;
};

type SkillState = {
  byRepo: Record<string, Skill[]>;
  defaultSkills: Skill[];
  systemSkills: Skill[];
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;
  scanRepository: (repoId: string, repoPath: string) => Promise<void>;
  scanDefaultCatalog: () => Promise<void>;
  scanSystemCatalog: () => Promise<void>;
};

export const useSkillStore = create<SkillState>((set, get) => ({
  byRepo: {},
  defaultSkills: [],
  systemSkills: [],
  loading: {},
  errors: {},

  scanRepository: async (repoId, repoPath) => {
    if (get().loading[repoId]) return;

    set((s) => ({
      loading: { ...s.loading, [repoId]: true },
      errors: { ...s.errors, [repoId]: null },
    }));

    try {
      const raw = await getHostBridge().scanSkills(repoPath);
      const skills: Skill[] = raw.map((r) => {
        const meta = parseSkillMeta(r.content, r.dirName);
        return {
          id: `${r.provider}:${r.rootDir}`,
          provider: r.provider,
          source: "repository",
          name: meta.name,
          description: meta.description,
          inputHints: meta.inputHints,
          rootDir: r.rootDir,
          skillFile: r.skillFile,
          ...(r.skillFileAbsPath ? { skillFileAbsPath: r.skillFileAbsPath } : {}),
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

  scanDefaultCatalog: async () => {
    if (get().loading.default) return;

    set((s) => ({
      loading: { ...s.loading, default: true },
      errors: { ...s.errors, default: null },
    }));

    try {
      const bridge = getHostBridge();
      if (!bridge.scanDefaultSkills) {
        throw new Error("default skill scan is not available");
      }
      const raw = await bridge.scanDefaultSkills();
      const skills: Skill[] = raw.map((r) => {
        const meta = parseSkillMeta(r.content, r.dirName);
        return {
          id: `${r.provider}:${r.rootDir}`,
          provider: r.provider,
          source: "default",
          name: meta.name,
          description: meta.description,
          inputHints: meta.inputHints,
          rootDir: r.rootDir,
          skillFile: r.skillFile,
          ...(r.skillFileAbsPath ? { skillFileAbsPath: r.skillFileAbsPath } : {}),
        };
      });
      set((s) => ({
        defaultSkills: skills,
        loading: { ...s.loading, default: false },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => ({
        errors: { ...s.errors, default: message },
        loading: { ...s.loading, default: false },
      }));
    }
  },

  scanSystemCatalog: async () => {
    if (get().loading.system) return;

    set((s) => ({
      loading: { ...s.loading, system: true },
      errors: { ...s.errors, system: null },
    }));

    try {
      const bridge = getHostBridge();
      if (!bridge.scanSystemSkills) {
        throw new Error("system skill catalog scan is not available");
      }
      const raw = await bridge.scanSystemSkills();
      const skills: Skill[] = raw.map((r) => ({
        id: r.id,
        provider: r.provider,
        source: "system",
        name: r.name,
        description: r.description,
        inputHints: [],
        rootDir: "",
        skillFile: "",
        systemSkillId: r.id,
      }));
      set((s) => ({
        systemSkills: skills,
        loading: { ...s.loading, system: false },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => ({
        errors: { ...s.errors, system: message },
        loading: { ...s.loading, system: false },
      }));
    }
  },
}));
