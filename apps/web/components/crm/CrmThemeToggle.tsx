"use client";

import { useEffect, useState } from "react";

const THEME_KEY = "avtocena_theme";
type Theme = "dark" | "light";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(THEME_KEY, theme);
  window.dispatchEvent(new CustomEvent("avtocena:theme-changed", { detail: { theme } }));
}

export function CrmThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    const stored = localStorage.getItem(THEME_KEY);
    const initial: Theme = current === "light" || current === "dark"
      ? current
      : stored === "light" || stored === "dark"
        ? stored
        : "dark";
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => {
        setTheme(nextTheme);
        applyTheme(nextTheme);
      }}
      className="crm-theme-toggle grid h-10 w-10 place-items-center rounded-full bg-white/10 text-lg transition hover:bg-white/15"
      aria-label={nextTheme === "light" ? "Включить светлую тему" : "Включить тёмную тему"}
      title={nextTheme === "light" ? "Светлая тема" : "Тёмная тема"}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
