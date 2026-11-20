"use client";

import { setSiteTheme, useSiteTheme } from "@/lib/theme/use-site-theme";

export function CrmThemeToggle() {
  const { theme } = useSiteTheme();
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setSiteTheme(nextTheme)}
      className="crm-theme-toggle grid h-10 w-10 place-items-center rounded-full bg-white/10 text-lg transition hover:bg-white/15"
      aria-label={nextTheme === "light" ? "Включить светлую тему" : "Включить тёмную тему"}
      title={nextTheme === "light" ? "Светлая тема" : "Тёмная тема"}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
