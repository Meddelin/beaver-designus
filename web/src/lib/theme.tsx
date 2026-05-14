import * as React from "react";

type Theme = "dark" | "light";
const STORAGE_KEY = "bd.theme";

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}
const Ctx = React.createContext<ThemeCtx | null>(null);

function readInitial(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  // Default to dark — the design language is tuned for dark surfaces. The user
  // can flip to light via Cmd-Shift-L, the topbar toggle, or the command palette.
  return "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [theme, setThemeState] = React.useState<Theme>(readInitial);

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = React.useCallback((t: Theme) => setThemeState(t), []);
  const toggle = React.useCallback(() => setThemeState((t) => (t === "dark" ? "light" : "dark")), []);

  const value = React.useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useTheme outside ThemeProvider");
  return v;
}
