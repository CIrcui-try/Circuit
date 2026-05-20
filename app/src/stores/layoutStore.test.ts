import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutPrefsDTO } from "../host/bridge";

const bridgeMock = vi.hoisted(() => ({
  loadLayout: vi.fn(),
  saveLayout: vi.fn(),
}));

vi.mock("../host/bridge", () => ({
  getHostBridge: () => bridgeMock,
}));

import { LAYOUT_DEFAULTS, useLayoutStore } from "./layoutStore";

beforeEach(() => {
  vi.useFakeTimers();
  bridgeMock.loadLayout.mockReset();
  bridgeMock.saveLayout.mockReset();
  bridgeMock.loadLayout.mockResolvedValue(null);
  bridgeMock.saveLayout.mockResolvedValue(undefined);
  useLayoutStore.setState({
    sidebarWidth: LAYOUT_DEFAULTS.sidebarWidth,
    propsWidth: LAYOUT_DEFAULTS.propsWidth,
    logHeight: LAYOUT_DEFAULTS.logHeight,
    sidebarCollapsed: false,
    commonSkillsCollapsed: false,
    propsCollapsed: false,
    logCollapsed: false,
    hydrated: false,
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("layoutStore — hydrate", () => {
  it("restores persisted panel visibility with layout dimensions", async () => {
    bridgeMock.loadLayout.mockResolvedValue({
      sidebarWidth: 320,
      propsWidth: 360,
      logHeight: 220,
      sidebarCollapsed: true,
      commonSkillsCollapsed: true,
      propsCollapsed: true,
      logCollapsed: true,
    } satisfies LayoutPrefsDTO);

    await useLayoutStore.getState().hydrate();

    expect(useLayoutStore.getState()).toMatchObject({
      sidebarWidth: 320,
      propsWidth: 360,
      logHeight: 220,
      sidebarCollapsed: true,
      commonSkillsCollapsed: true,
      propsCollapsed: true,
      logCollapsed: true,
      hydrated: true,
    });
  });

  it("defaults missing persisted visibility fields to visible panels", async () => {
    bridgeMock.loadLayout.mockResolvedValue({
      sidebarWidth: 300,
      propsWidth: 340,
      logHeight: 200,
    } satisfies LayoutPrefsDTO);

    await useLayoutStore.getState().hydrate();

    expect(useLayoutStore.getState()).toMatchObject({
      sidebarCollapsed: false,
      commonSkillsCollapsed: false,
      propsCollapsed: false,
      logCollapsed: false,
      hydrated: true,
    });
  });
});

describe("layoutStore — persist", () => {
  it("persists panel visibility with the current dimensions", async () => {
    useLayoutStore.setState({
      sidebarWidth: 300,
      propsWidth: 340,
      logHeight: 200,
      hydrated: true,
    });

    useLayoutStore.getState().setSidebarCollapsed(true);

    await vi.advanceTimersByTimeAsync(250);

    expect(bridgeMock.saveLayout).toHaveBeenCalledWith({
      sidebarWidth: 300,
      propsWidth: 340,
      logHeight: 200,
      sidebarCollapsed: true,
      commonSkillsCollapsed: false,
      propsCollapsed: false,
      logCollapsed: false,
    });
  });

  it("persists toggled properties and run log visibility", async () => {
    useLayoutStore.setState({ hydrated: true });

    useLayoutStore.getState().togglePropsCollapsed();
    useLayoutStore.getState().toggleLogCollapsed();

    await vi.advanceTimersByTimeAsync(250);

    expect(bridgeMock.saveLayout).toHaveBeenCalledTimes(1);
    expect(bridgeMock.saveLayout).toHaveBeenLastCalledWith({
      sidebarWidth: LAYOUT_DEFAULTS.sidebarWidth,
      propsWidth: LAYOUT_DEFAULTS.propsWidth,
      logHeight: LAYOUT_DEFAULTS.logHeight,
      sidebarCollapsed: false,
      commonSkillsCollapsed: false,
      propsCollapsed: true,
      logCollapsed: true,
    });
  });

  it("persists toggled common skills visibility", async () => {
    useLayoutStore.setState({ hydrated: true });

    useLayoutStore.getState().toggleCommonSkillsCollapsed();

    await vi.advanceTimersByTimeAsync(250);

    expect(bridgeMock.saveLayout).toHaveBeenCalledWith({
      sidebarWidth: LAYOUT_DEFAULTS.sidebarWidth,
      propsWidth: LAYOUT_DEFAULTS.propsWidth,
      logHeight: LAYOUT_DEFAULTS.logHeight,
      sidebarCollapsed: false,
      commonSkillsCollapsed: true,
      propsCollapsed: false,
      logCollapsed: false,
    });
  });
});
