export type FocusRegion = "sidebar" | "editor" | "workspace-picker" | "global";

class FocusContextStore {
  activeRegion: FocusRegion = $state("global");

  setActiveRegion(region: FocusRegion) {
    this.activeRegion = region;
  }
}

export const focusContextStore = new FocusContextStore();
