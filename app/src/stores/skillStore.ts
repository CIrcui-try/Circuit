import { create } from "zustand";
import {
  getHostBridge,
  type CreateRepositorySkillInput,
  type DeleteRepositorySkillInput,
} from "../host/bridge";
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
  defaultInput?: Record<string, string>;
  defaultModel?: string;
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
  creating: Record<string, boolean>;
  deleting: Record<string, boolean>;
  errors: Record<string, string | null>;
  scanRepository: (repoId: string, repoPath: string) => Promise<void>;
  createRepositorySkill: (
    repoId: string,
    repoPath: string,
    input: CreateRepositorySkillInput,
  ) => Promise<Skill>;
  deleteRepositorySkill: (
    repoId: string,
    repoPath: string,
    input: DeleteRepositorySkillInput,
  ) => Promise<void>;
  scanDefaultCatalog: () => Promise<void>;
  scanSystemCatalog: () => Promise<void>;
};

function toRepositorySkill(raw: {
  provider: SkillProvider;
  dirName: string;
  rootDir: string;
  skillFile: string;
  skillFileAbsPath?: string;
  content: string;
}): Skill {
  const meta = parseSkillMeta(raw.content, raw.dirName);
  return {
    id: `${raw.provider}:${raw.rootDir}`,
    provider: raw.provider,
    source: "repository",
    name: meta.name,
    description: meta.description,
    inputHints: meta.inputHints,
    ...(meta.defaultInput ? { defaultInput: meta.defaultInput } : {}),
    ...(meta.defaultModel ? { defaultModel: meta.defaultModel } : {}),
    rootDir: raw.rootDir,
    skillFile: raw.skillFile,
    ...(raw.skillFileAbsPath ? { skillFileAbsPath: raw.skillFileAbsPath } : {}),
  };
}

export const useSkillStore = create<SkillState>((set, get) => ({
  byRepo: {},
  defaultSkills: [],
  systemSkills: [],
  loading: {},
  creating: {},
  deleting: {},
  errors: {},

  scanRepository: async (repoId, repoPath) => {
    if (get().loading[repoId]) return;

    set((s) => ({
      loading: { ...s.loading, [repoId]: true },
      errors: { ...s.errors, [repoId]: null },
    }));

    try {
      const raw = await getHostBridge().scanSkills(repoPath);
      const skills: Skill[] = raw.map(toRepositorySkill);
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

  createRepositorySkill: async (repoId, repoPath, input) => {
    if (get().creating[repoId]) {
      throw new Error("skill creation is already in progress");
    }

    set((s) => ({
      creating: { ...s.creating, [repoId]: true },
      errors: { ...s.errors, [repoId]: null },
    }));

    const bridge = getHostBridge();
    if (!bridge.createRepositorySkill) {
      const message = "repository skill creation is not available";
      set((s) => ({
        creating: { ...s.creating, [repoId]: false },
      }));
      throw new Error(message);
    }

    let createdSkill: Skill;
    try {
      createdSkill = toRepositorySkill(
        await bridge.createRepositorySkill(repoPath, input),
      );
    } catch (err) {
      set((s) => ({
        creating: { ...s.creating, [repoId]: false },
      }));
      throw err;
    }

    let refreshedSkills: Skill[];
    try {
      refreshedSkills = (await bridge.scanSkills(repoPath)).map(toRepositorySkill);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const message = `Skill was created, but repository re-scan failed: ${reason}`;
      set((s) => ({
        creating: { ...s.creating, [repoId]: false },
      }));
      throw new Error(message);
    }

    const refreshedSkill = refreshedSkills.find(
      (skill) => skill.id === createdSkill.id,
    );
    if (!refreshedSkill) {
      const message =
        "Skill was created, but it was not found in the refreshed skill list.";
      set((s) => ({
        byRepo: { ...s.byRepo, [repoId]: refreshedSkills },
        creating: { ...s.creating, [repoId]: false },
      }));
      throw new Error(message);
    }

    set((s) => ({
      byRepo: { ...s.byRepo, [repoId]: refreshedSkills },
      creating: { ...s.creating, [repoId]: false },
    }));

    return refreshedSkill;
  },

  deleteRepositorySkill: async (repoId, repoPath, input) => {
    if (get().deleting[repoId]) {
      throw new Error("skill deletion is already in progress");
    }

    set((s) => ({
      deleting: { ...s.deleting, [repoId]: true },
      errors: { ...s.errors, [repoId]: null },
    }));

    const bridge = getHostBridge();
    if (!bridge.deleteRepositorySkill) {
      const message = "repository skill deletion is not available";
      set((s) => ({
        deleting: { ...s.deleting, [repoId]: false },
      }));
      throw new Error(message);
    }

    try {
      await bridge.deleteRepositorySkill(repoPath, input);
    } catch (err) {
      set((s) => ({
        deleting: { ...s.deleting, [repoId]: false },
      }));
      throw err;
    }

    let refreshedSkills: Skill[];
    try {
      refreshedSkills = (await bridge.scanSkills(repoPath)).map(toRepositorySkill);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      set((s) => ({
        deleting: { ...s.deleting, [repoId]: false },
      }));
      throw new Error(`Skill was removed, but repository re-scan failed: ${reason}`);
    }

    set((s) => ({
      byRepo: { ...s.byRepo, [repoId]: refreshedSkills },
      deleting: { ...s.deleting, [repoId]: false },
    }));
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
