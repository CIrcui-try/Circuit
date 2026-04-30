import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMock = vi.hoisted(() => ({
  data: new Map<string, unknown>(),
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get = storeMock.get;
    set = storeMock.set;
    save = storeMock.save;
  },
}));

import { useRepositoryStore } from "./repositoryStore";

beforeEach(() => {
  storeMock.data.clear();
  storeMock.get.mockReset();
  storeMock.set.mockReset();
  storeMock.save.mockReset();

  storeMock.get.mockImplementation(async (key: string) => storeMock.data.get(key));
  storeMock.set.mockImplementation(async (key: string, value: unknown) => {
    storeMock.data.set(key, value);
  });
  storeMock.save.mockImplementation(async () => {});

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
    const seeded = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "alpha",
        path: "/Users/me/alpha",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    storeMock.data.set("repositories", seeded);

    await useRepositoryStore.getState().hydrate();

    expect(useRepositoryStore.getState().repositories).toEqual(seeded);
    expect(useRepositoryStore.getState().hydrated).toBe(true);
  });

  it("U3: skips re-hydration when already hydrated", async () => {
    await useRepositoryStore.getState().hydrate();
    await useRepositoryStore.getState().hydrate();
    expect(storeMock.get).toHaveBeenCalledTimes(1);
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
    expect(storeMock.set).toHaveBeenCalledTimes(1);
  });

  it("U6: persists via store.set then store.save", async () => {
    await useRepositoryStore.getState().hydrate();

    const setOrder: string[] = [];
    storeMock.set.mockImplementationOnce(async (key: string, value: unknown) => {
      setOrder.push("set");
      storeMock.data.set(key, value);
    });
    storeMock.save.mockImplementationOnce(async () => {
      setOrder.push("save");
    });

    await useRepositoryStore.getState().addRepository("/Users/me/repo");

    expect(setOrder).toEqual(["set", "save"]);
    expect(storeMock.set).toHaveBeenCalledWith("repositories", expect.any(Array));
    const persisted = storeMock.data.get("repositories") as Array<{ path: string }>;
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
  const seed = [
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

  it("Rm1: removes the matching repo and persists via store.set + save; unknown id is no-op", async () => {
    useRepositoryStore.setState({ repositories: seed, selectedId: null, hydrated: true });

    await useRepositoryStore.getState().removeRepository("id-a");
    expect(useRepositoryStore.getState().repositories).toEqual([seed[1]]);
    expect(storeMock.set).toHaveBeenCalledWith("repositories", [seed[1]]);
    expect(storeMock.save).toHaveBeenCalledTimes(1);

    storeMock.set.mockClear();
    storeMock.save.mockClear();

    await useRepositoryStore.getState().removeRepository("does-not-exist");
    expect(useRepositoryStore.getState().repositories).toEqual([seed[1]]);
    expect(storeMock.set).not.toHaveBeenCalled();
    expect(storeMock.save).not.toHaveBeenCalled();
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
