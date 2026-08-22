"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

const THEME_STORAGE_KEY = "verisnova-theme";
const THEME_VALUES = new Set(["dark", "light"]);
// Shared with the War Room app (verisnova-war) so a theme choice made here is
// readable there without a server round trip, and vice versa.
const SHARED_THEME_COOKIE = "verisnova-theme";
const SHARED_COOKIE_DOMAIN = ".verisnova.com";
const SHARED_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const ThemeContext = createContext({
  theme: "light",
  resolvedTheme: "light",
  setTheme: () => {},
});

function writeSharedThemeCookie(theme) {
  if (typeof document === "undefined") {
    return;
  }

  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${SHARED_THEME_COOKIE}=${encodeURIComponent(theme)}; Domain=${SHARED_COOKIE_DOMAIN}; Path=/; Max-Age=${SHARED_COOKIE_MAX_AGE_SECONDS}; SameSite=None${secure}`;
  } catch {
    // Cookie domain won't match on localhost/other hosts - safe to ignore.
  }
}

function applyTheme(theme) {
  const root = document.documentElement;

  root.dataset.themePreference = theme;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  writeSharedThemeCookie(theme);

  return theme;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState("light");
  const [resolvedTheme, setResolvedTheme] = useState("light");

  useEffect(() => {
    const rootPreference = document.documentElement.dataset.themePreference;
    const storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initialTheme = THEME_VALUES.has(storedPreference)
      ? storedPreference
      : THEME_VALUES.has(rootPreference)
        ? rootPreference
        : "light";

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
