const KEY = "emergent-theme";

type Mode = "system" | "dark" | "light";

function loadStoredMode(): Mode {
  if (typeof localStorage === "undefined") return "dark";
  const v = localStorage.getItem(KEY);
  if (v === "dark" || v === "light" || v === "system") return v;
  return "dark";
}

function systemPrefersDarkInitial(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function createThemeStore() {
  let mode = $state<Mode>(loadStoredMode());
  let systemDark = $state<boolean>(systemPrefersDarkInitial());
  const current = $derived<"dark" | "light">(
    mode === "system" ? (systemDark ? "dark" : "light") : mode,
  );

  $effect.root(() => {
    $effect(() => {
      if (typeof document === "undefined") return;
      document.documentElement.setAttribute("data-theme", current);
      try {
        localStorage.setItem(KEY, mode);
      } catch {
        /* ignore quota or access errors */
      }
    });

    if (typeof window === "undefined" || !window.matchMedia) {
      return () => {};
    }
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e: MediaQueryListEvent) => {
      systemDark = e.matches;
    };
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  });

  return {
    get mode() {
      return mode;
    },
    get current() {
      return current;
    },
    setMode(next: Mode) {
      mode = next;
    },
    set(next: "dark" | "light") {
      mode = next;
    },
    toggle() {
      mode = current === "dark" ? "light" : "dark";
    },
  };
}

export const themeStore = createThemeStore();
