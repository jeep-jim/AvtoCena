"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";

const FAVORITES_KEY = "avtocena_favorites";
const THEME_KEY = "avtocena_theme";

type Props = {
  backHref?: string;
  backLabel?: string;
  className?: string;
};

type Theme = "dark" | "light";

function readCount() {
  try {
    const items = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(items) ? items.length : 0;
  } catch {
    return 0;
  }
}

function applyBrowserTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);

  let icon = document.querySelector<HTMLLinkElement>('link[data-avtocena-theme-icon]');
  if (!icon) {
    icon = document.createElement("link");
    icon.rel = "icon";
    icon.dataset.avtocenaThemeIcon = "true";
    document.head.appendChild(icon);
  }
  icon.href = theme === "light" ? "/favicon-dark.svg" : "/favicon-light.svg";
  window.dispatchEvent(new CustomEvent("avtocena:theme-changed", { detail: { theme } }));
}

function StarIcon({ filled = true }: { filled?: boolean }) {
  return (
    <svg width="25" height="25" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} aria-hidden="true">
      <path d="M12 2.7L14.85 8.5L21.25 9.43L16.62 13.94L17.71 20.31L12 17.31L6.29 20.31L7.38 13.94L2.75 9.43L9.15 8.5L12 2.7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "light") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M20.2 15.2A8.4 8.4 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M12 2V4M12 20V22M4.9 4.9L6.3 6.3M17.7 17.7L19.1 19.1M2 12H4M20 12H22M4.9 19.1L6.3 17.7M17.7 6.3L19.1 4.9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CarIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 14.5V11.8L6.5 7.5H17.5L20 11.8V17H18.2M5.8 17H4V14.5H20V17H18.2M8 17H16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7.3" cy="17" r="2" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="16.7" cy="17" r="2" stroke="currentColor" strokeWidth="1.9" />
      <path d="M6.6 11.5H17.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export function PublicHeader({ backHref, backLabel = "Назад", className = "" }: Props) {
  const [favoritesCount, setFavoritesCount] = useState(0);
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const update = () => setFavoritesCount(readCount());
    update();
    window.addEventListener("storage", update);
    window.addEventListener("avtocena:favorites-changed", update as EventListener);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("avtocena:favorites-changed", update as EventListener);
    };
  }, []);

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    const stored = localStorage.getItem(THEME_KEY);
    const initial: Theme = current === "light" || current === "dark"
      ? current
      : stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia?.("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    setTheme(initial);
    applyBrowserTheme(initial);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyBrowserTheme(next);
  }

  const favoriteButtonClass = theme === "dark"
    ? "bg-[#ff353d] text-white hover:bg-[#ff353d]"
    : "bg-[#f1e4e6] text-[#d92534] hover:bg-[#ead7da]";
  const favoriteBadgeClass = theme === "dark" ? "bg-[#10131b]" : "bg-[#ff353d]";
  const themeIconClass = theme === "dark" ? "text-amber-300" : "text-slate-600";

  return (
    <header className={`ac-public-header sticky top-0 z-50 bg-[#070a12]/90 backdrop-blur-xl ${className}`}>
      <div className="mx-auto flex h-16 w-full max-w-[1500px] items-center justify-between gap-3 px-4 md:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          {backHref ? (
            <Link href={backHref} className="flex h-10 items-center gap-2 rounded-xl bg-white/[0.055] px-3 text-sm font-black text-white/72 transition hover:bg-white/[0.09] hover:text-white">
              <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M15 9H3M7 5L3 9L7 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="hidden sm:inline">{backLabel}</span>
            </Link>
          ) : null}

          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <BrandMark className="h-9 w-9 shrink-0 md:h-10 md:w-10" />
            <div className="min-w-0">
              <div className="text-[18px] font-black leading-none md:text-[22px]"><span className="text-red-500">Авто</span><span className="text-white">Цена</span></div>
              <div className="text-[11px] font-bold leading-none text-white/42">подбор · расчёт</div>
            </div>
          </Link>
        </div>

        <div className="flex items-center gap-1.5 md:gap-2">
          <button type="button" onClick={toggleTheme} className={`ac-icon-button flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.045] transition hover:bg-white/[0.085] ${themeIconClass}`} aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"} title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}>
            <ThemeIcon theme={theme} />
          </button>

          <Link href="/favorites" className={`ac-favorite-nav relative flex h-11 w-12 items-center justify-center rounded-xl transition ${favoriteButtonClass}`} aria-label="Избранные автомобили">
            <StarIcon />
            {favoritesCount > 0 ? (
              <span className={`absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-black ${favoriteBadgeClass}`} style={{ color: "#fff", WebkitTextFillColor: "#fff" }}>
                {Math.min(favoritesCount, 99)}
              </span>
            ) : null}
          </Link>

          <nav className="hidden items-center text-sm font-black text-white/72 md:flex" aria-label="Основная навигация">
            <Link href="/cars" className="flex h-11 items-center gap-2 rounded-xl px-4 transition hover:bg-white/[0.06] hover:text-white">
              <CarIcon />
              <span>Каталог</span>
            </Link>
          </nav>

          <Link href="/cars" className="ac-icon-button flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.045] text-white/84 transition hover:bg-white/[0.085] md:hidden" aria-label="Открыть каталог" title="Каталог">
            <CarIcon />
          </Link>
        </div>
      </div>
    </header>
  );
}
