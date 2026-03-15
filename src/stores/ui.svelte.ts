class UIStore {
  sidebarCollapsed = $state(true);
  activeView: "workspace" | "vcs" = $state("workspace");

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  setSidebarCollapsed(collapsed: boolean) {
    this.sidebarCollapsed = collapsed;
  }

  setActiveView(view: "workspace" | "vcs") {
    this.activeView = view;
  }
}

export const uiStore = new UIStore();
