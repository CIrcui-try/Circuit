import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMock = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  openRepositoryDialog: vi.fn(),
  scanSkills: vi.fn(),
  loadRepositories: vi.fn(),
  saveRepositories: vi.fn(),
}));

vi.mock("../host/bridge", () => ({
  getHostBridge: () => bridgeMock,
}));

import { useRepositoryStore, type Repository } from "./repositoryStore";

beforeEach(() => {
  bridgeMock.store.clear();
  bridgeMock.openRepositoryDialog.mockReset();
  bridgeMock.scanSkills.mockReset();
  bridgeMock.loadRepositories.mockReset();
  bridgeMock.saveRepositories.mockReset();

  bridgeMock.loadRepositories.mockImplementation(
    async () => (bridgeMock.store.get("repositories") as Repository[]) ?? null,
  );
  bridgeMock.saveRepositories.mockImplementation(async (repos: Repository[]) => {
    bridgeMock.store.set("repositories", repos);
  });

  useRepositoryStore.setState({
    repositories: [],
    selectedId: null,
    hydrated: false,
  });
});

describe("repositoryStore — hydrate", () => {
  it("U1: loads empty state when persisted store is empty", async () => {
    await useRepositoryStore.getState().hydrate();
    const s = useRepositoryStore.getState();
    expect(s.repositories).toEqual([]);
    expect(s.hydrated).toBe(true);
  });

  it("U2: loads persisted repositories into memory", async () => {
    const seeded: Repository[] = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "alpha",
        path: "/Users/me/alpha",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    bridgeMock.store.set("repositories", seeded);

    await useRepositoryStore.getState().hydrate();

    expect(useRepositoryStore.getState().repositories).toEqual(seeded);
    expect(useRepositoryStore.getState().hydrated).toBe(true);
  });

  it("U3: skips re-hydration when already hydrated", async () => {
    await useRepositoryStore.getState().hydrate();
    await useRepositoryStore.getState().hydrate();
    expect(bridgeMock.loadRepositories).toHaveBeenCalledTimes(1);
  });
});

describe("repositoryStore — addRepository", () => {
  it("U4: creates a repo with uuid id, basename, normalized path, ISO timestamps", async () => {
    await useRepositoryStore.getState().hydrate();

    const repo = await useRepositoryStore.getState().addRepository("/Users/foo/bar");

    expect(repo).not.toBeNull();
    expect(repo!.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(repo!.name).toBe("bar");
    expect(repo!.path).toBe("/Users/foo/bar");
    expect(repo!.createdAt).toBe(repo!.updatedAt);
    expect(new Date(repo!.createdAt).toISOString()).toBe(repo!.createdAt);
  });

  it("U5: silently dedupes against same path with differing trailing slashes", async () => {
    await useRepositoryStore.getState().hydrate();

    const first = await useRepositoryStore.getState().addRepository("/Users/foo/bar");
    const second = await useRepositoryStore.getState().addRepository("/Users/foo/bar/");
    const third = await useRepositoryStore.getState().addRepository("/Users/foo/bar///");

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(third).toBeNull();

    const repos = useRepositoryStore.getState().repositories;
    expect(repos).toHaveLength(1);
    expect(repos[0].path).toBe("/Users/foo/bar");
    expect(bridgeMock.saveRepositories).toHaveBeenCalledTimes(1);
  });

  it("U6: persists via bridge.saveRepositories with the new repo list", async () => {
    await useRepositoryStore.getState().hydrate();

    await useRepositoryStore.getState().addRepository("/Users/me/repo");

    expect(bridgeMock.saveRepositories).toHaveBeenCalledTimes(1);
    const persisted = bridgeMock.store.get("repositories") as Array<{ path: string }>;
    expect(persisted).toHaveLength(1);
    expect(persisted[0].path).toBe("/Users/me/repo");
  });
});

describe("repositoryStore — selectRepository", () => {
  it("U7a: sets selectedId to the given id", () => {
    useRepositoryStore.getState().selectRepository("abc");
    expect(useRepositoryStore.getState().selectedId).toBe("abc");
  });

  it("U7b: clears selectedId when null is passed", () => {
    useRepositoryStore.setState({ selectedId: "abc" });
    useRepositoryStore.getState().selectRepository(null);
    expect(useRepositoryStore.getState().selectedId).toBeNull();
  });
});

describe("repositoryStore — removeRepository", () => {
  const seed: Repository[] = [
    {
      id: "id-a",
      name: "a",
      path: "/Users/me/a",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "id-b",
      name: "b",
      path: "/Users/me/b",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("Rm1: removes the matching repo and persists; unknown id is no-op", async () => {
    useRepositoryStore.setState({ repositories: seed, selectedId: null, hydrated: true });

    await useRepositoryStore.getState().removeRepository("id-a");
    expect(useRepositoryStore.getState().repositories).toEqual([seed[1]]);
    expect(bridgeMock.saveRepositories).toHaveBeenCalledWith([seed[1]]);

    bridgeMock.saveRepositories.mockClear();

    await useRepositoryStore.getState().removeRepository("does-not-exist");
    expect(useRepositoryStore.getState().repositories).toEqual([seed[1]]);
    expect(bridgeMock.saveRepositories).not.toHaveBeenCalled();
  });

  it("Rm2: clears selectedId when removing the currently selected repo, leaves it otherwise", async () => {
    useRepositoryStore.setState({ repositories: seed, selectedId: "id-a", hydrated: true });

    await useRepositoryStore.getState().removeRepository("id-a");
    expect(useRepositoryStore.getState().selectedId).toBeNull();

    useRepositoryStore.setState({ repositories: seed, selectedId: "id-b", hydrated: true });

    await useRepositoryStore.getState().removeRepository("id-a");
    expect(useRepositoryStore.getState().selectedId).toBe("id-b");
  });
});

describe("repositoryStore — basename derivation", () => {
  it("U8: uses last path segment as repo name even with multiple slashes", async () => {
    await useRepositoryStore.getState().hydrate();
    const repo = await useRepositoryStore.getState().addRepository("/a/b/c/deep-name");
    expect(repo!.name).toBe("deep-name");
  });
});
