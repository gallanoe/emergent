class UIStore {
  sidebarCollapsed = $state(false);

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  setSidebarCollapsed(collapsed: boolean) {
    this.sidebarCollapsed = collapsed;
  }
}

export const uiStore = new UIStore();
