import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";

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

const STORE_FILE = "repositories.json";
const STORE_KEY = "repositories";

const store = new LazyStore(STORE_FILE);

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
    const stored = await store.get<Repository[]>(STORE_KEY);
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
    await store.set(STORE_KEY, next);
    await store.save();
    return repo;
  },

  removeRepository: async (id) => {
    const existing = get().repositories;
    const next = existing.filter((r) => r.id !== id);
    if (next.length === existing.length) return;
    const selectedId = get().selectedId === id ? null : get().selectedId;
    set({ repositories: next, selectedId });
    await store.set(STORE_KEY, next);
    await store.save();
  },

  selectRepository: (id) => set({ selectedId: id }),
}));
