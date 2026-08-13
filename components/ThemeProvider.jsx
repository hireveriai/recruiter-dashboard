"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

const THEME_STORAGE_KEY = "hireveri-theme";
const THEME_VALUES = new Set(["dark", "light"]);

const ThemeContext = createContext({
  theme: "dark",
  resolvedTheme: "dark",
  setTheme: () => {},
});

function applyTheme(theme) {
  const root = document.documentElement;

  root.dataset.themePreference = theme;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;

  return theme;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState("dark");
  const [resolvedTheme, setResolvedTheme] = useState("dark");

  useEffect(() => {
    const rootPreference = document.documentElement.dataset.themePreference;
    const storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initialTheme = THEME_VALUES.has(storedPreference)
      ? storedPreference
      : THEME_VALUES.has(rootPreference)
        ? rootPreference
        : "dark";

    const initialResolvedTheme = applyTheme(initialTheme);
    queueMicrotask(() => {
      setThemeState(initialTheme);
      setResolvedTheme(initialResolvedTheme);
    });
  }, []);

  const setTheme = (nextTheme) => {
    if (!THEME_VALUES.has(nextTheme)) {
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    setThemeState(nextTheme);
    setResolvedTheme(applyTheme(nextTheme));
  };

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [resolvedTheme, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
