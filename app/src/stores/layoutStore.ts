import { create } from "zustand";
import { getHostBridge } from "../host/bridge";
import type { LayoutPrefsDTO } from "../host/bridge";

export const LAYOUT_DEFAULTS = {
  sidebarWidth: 240,
  propsWidth: 280,
  logHeight: 180,
} as const;

export const LAYOUT_LIMITS = {
  sidebar: { min: 160, max: 480 },
  props: { min: 200, max: 560 },
  log: { min: 80, maxRatio: 0.6 },
} as const;

type LayoutState = {
  sidebarWidth: number;
  propsWidth: number;
  logHeight: number;
  sidebarCollapsed: boolean;
  commonSkillsCollapsed: boolean;
  propsCollapsed: boolean;
  logCollapsed: boolean;
  hydrated: boolean;
  setSidebarWidth: (px: number) => void;
  setPropsWidth: (px: number) => void;
  setLogHeight: (px: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setCommonSkillsCollapsed: (collapsed: boolean) => void;
  toggleCommonSkillsCollapsed: () => void;
  setPropsCollapsed: (collapsed: boolean) => void;
  togglePropsCollapsed: () => void;
  setLogCollapsed: (collapsed: boolean) => void;
  toggleLogCollapsed: () => void;
  hydrate: () => Promise<void>;
};

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}

function logMax(): number {
  if (typeof window === "undefined") return 600;
  return Math.max(LAYOUT_LIMITS.log.min, Math.floor(window.innerHeight * LAYOUT_LIMITS.log.maxRatio));
}

function applyVars(state: Pick<LayoutState, "sidebarWidth" | "propsWidth" | "logHeight">) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--sidebar-width", `${state.sidebarWidth}px`);
  root.style.setProperty("--props-width", `${state.propsWidth}px`);
  root.style.setProperty("--log-height", `${state.logHeight}px`);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

type PersistedLayoutState = Pick<
  LayoutState,
  | "sidebarWidth"
  | "propsWidth"
  | "logHeight"
  | "sidebarCollapsed"
  | "commonSkillsCollapsed"
  | "propsCollapsed"
  | "logCollapsed"
>;

function toPrefs(state: PersistedLayoutState): LayoutPrefsDTO {
  return {
    sidebarWidth: state.sidebarWidth,
    propsWidth: state.propsWidth,
    logHeight: state.logHeight,
    sidebarCollapsed: state.sidebarCollapsed,
    commonSkillsCollapsed: state.commonSkillsCollapsed,
    propsCollapsed: state.propsCollapsed,
    logCollapsed: state.logCollapsed,
  };
}

function schedulePersist(state: PersistedLayoutState) {
  const bridge = getHostBridge();
  if (!bridge.saveLayout) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void bridge.saveLayout?.(toPrefs(state));
  }, 250);
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  sidebarWidth: LAYOUT_DEFAULTS.sidebarWidth,
  propsWidth: LAYOUT_DEFAULTS.propsWidth,
  logHeight: LAYOUT_DEFAULTS.logHeight,
  sidebarCollapsed: false,
  commonSkillsCollapsed: false,
  propsCollapsed: false,
  logCollapsed: false,
  hydrated: false,

  setSidebarWidth: (px) => {
    const next = clamp(px, LAYOUT_LIMITS.sidebar.min, LAYOUT_LIMITS.sidebar.max);
    if (next === get().sidebarWidth) return;
    set({ sidebarWidth: next });
    const s = get();
    applyVars(s);
    schedulePersist(s);
  },

  setPropsWidth: (px) => {
    const next = clamp(px, LAYOUT_LIMITS.props.min, LAYOUT_LIMITS.props.max);
    if (next === get().propsWidth) return;
    set({ propsWidth: next });
    const s = get();
    applyVars(s);
    schedulePersist(s);
  },

  setLogHeight: (px) => {
    const next = clamp(px, LAYOUT_LIMITS.log.min, logMax());
    if (next === get().logHeight) return;
    set({ logHeight: next });
    const s = get();
    applyVars(s);
    schedulePersist(s);
  },

  setSidebarCollapsed: (collapsed) => {
    if (collapsed === get().sidebarCollapsed) return;
    set({ sidebarCollapsed: collapsed });
    schedulePersist(get());
  },

  toggleSidebarCollapsed: () => {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
    schedulePersist(get());
  },

  setCommonSkillsCollapsed: (collapsed) => {
    if (collapsed === get().commonSkillsCollapsed) return;
    set({ commonSkillsCollapsed: collapsed });
    schedulePersist(get());
  },

  toggleCommonSkillsCollapsed: () => {
    set((state) => ({ commonSkillsCollapsed: !state.commonSkillsCollapsed }));
    schedulePersist(get());
  },

  setPropsCollapsed: (collapsed) => {
    if (collapsed === get().propsCollapsed) return;
    set({ propsCollapsed: collapsed });
    schedulePersist(get());
  },

  togglePropsCollapsed: () => {
    set((state) => ({ propsCollapsed: !state.propsCollapsed }));
    schedulePersist(get());
  },

  setLogCollapsed: (collapsed) => {
    if (collapsed === get().logCollapsed) return;
    set({ logCollapsed: collapsed });
    schedulePersist(get());
  },

  toggleLogCollapsed: () => {
    set((state) => ({ logCollapsed: !state.logCollapsed }));
    schedulePersist(get());
  },

  hydrate: async () => {
    if (get().hydrated) return;
    const bridge = getHostBridge();
    if (bridge.loadLayout) {
      try {
        const stored = await bridge.loadLayout();
        if (stored) {
          set({
            sidebarWidth: clamp(
              stored.sidebarWidth,
              LAYOUT_LIMITS.sidebar.min,
              LAYOUT_LIMITS.sidebar.max,
            ),
            propsWidth: clamp(
              stored.propsWidth,
              LAYOUT_LIMITS.props.min,
              LAYOUT_LIMITS.props.max,
            ),
            logHeight: clamp(stored.logHeight, LAYOUT_LIMITS.log.min, logMax()),
            sidebarCollapsed: optionalBoolean(stored.sidebarCollapsed) ?? false,
            commonSkillsCollapsed:
              optionalBoolean(stored.commonSkillsCollapsed) ?? false,
            propsCollapsed: optionalBoolean(stored.propsCollapsed) ?? false,
            logCollapsed: optionalBoolean(stored.logCollapsed) ?? false,
          });
        }
      } catch {
        // ignore hydration errors — fall back to defaults
      }
    }
    set({ hydrated: true });
    applyVars(get());
  },
}));
