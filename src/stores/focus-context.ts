import { create } from "zustand";

export type FocusRegion = "sidebar" | "editor" | "workspace-picker" | "global";

interface FocusContextState {
  activeRegion: FocusRegion;
  setActiveRegion: (region: FocusRegion) => void;
}

export const useFocusContextStore = create<FocusContextState>((set) => ({
  activeRegion: "global",
  setActiveRegion: (region) => set({ activeRegion: region }),
}));
