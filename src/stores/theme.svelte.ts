const KEY = "emergent-theme";

function loadStored(): "dark" | "light" {
  if (typeof localStorage === "undefined") return "dark";
  return localStorage.getItem(KEY) === "light" ? "light" : "dark";
}

function createThemeStore() {
  let current = $state<"dark" | "light">(loadStored());

  $effect.root(() => {
    $effect(() => {
      if (typeof document === "undefined") return;
      document.documentElement.setAttribute("data-theme", current);
      try {
        localStorage.setItem(KEY, current);
      } catch {
        /* ignore quota or access errors */
      }
    });
  });

  return {
    get current() {
      return current;
    },
    toggle() {
      current = current === "dark" ? "light" : "dark";
    },
    set(next: "dark" | "light") {
      current = next;
    },
  };
}

export const themeStore = createThemeStore();
