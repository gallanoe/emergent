function createThemeStore() {
  let theme = $state<"dark" | "light">(
    (typeof localStorage !== "undefined" &&
      (localStorage.getItem("emergent-theme") as "dark" | "light")) ||
      "dark",
  );

  return {
    get current() {
      return theme;
    },
    toggle() {
      theme = theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = theme;
      localStorage.setItem("emergent-theme", theme);
    },
  };
}

export const themeStore = createThemeStore();
