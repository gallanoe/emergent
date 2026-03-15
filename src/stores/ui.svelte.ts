class UIStore {
  activeView: "workspace" | "vcs" = $state("workspace");

  setActiveView(view: "workspace" | "vcs") {
    this.activeView = view;
  }
}

export const uiStore = new UIStore();
