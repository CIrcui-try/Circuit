import { create } from "zustand";
import { getHostBridge } from "../host/bridge";

export type Repository = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
};

type RepositoryState = {
  repositories: Repository[];
  selectedId: string | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addRepository: (path: string) => Promise<Repository | null>;
  removeRepository: (id: string) => Promise<void>;
  selectRepository: (id: string | null) => void;
};

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "");
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export const useRepositoryStore = create<RepositoryState>((set, get) => ({
  repositories: [],
  selectedId: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const stored = await getHostBridge().loadRepositories();
    set({ repositories: stored ?? [], hydrated: true });
  },

  addRepository: async (rawPath: string) => {
    const path = normalizePath(rawPath);
    const existing = get().repositories;
    if (existing.some((r) => r.path === path)) return null;

    const now = new Date().toISOString();
    const repo: Repository = {
      id: crypto.randomUUID(),
      name: basename(path),
      path,
      createdAt: now,
      updatedAt: now,
    };
    const next = [...existing, repo];
    set({ repositories: next });
    await getHostBridge().saveRepositories(next);
    return repo;
  },

  removeRepository: async (id) => {
    const existing = get().repositories;
    const next = existing.filter((r) => r.id !== id);
    if (next.length === existing.length) return;
    const selectedId = get().selectedId === id ? null : get().selectedId;
    set({ repositories: next, selectedId });
    await getHostBridge().saveRepositories(next);
  },

  selectRepository: (id) => set({ selectedId: id }),
}));
