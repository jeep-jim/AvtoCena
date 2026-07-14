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

function HeartIcon({ filled = true }: { filled?: boolean }) {
  return (
    <svg width="25" height="23" viewBox="0 0 24 22" fill={filled ? "currentColor" : "none"} aria-hidden="true">
      <path
        d="M12 20.1C10.9 19.1 4.2 13.4 2.4 9.7C.7 6.3 2.5 2.1 6.4 1.5C8.7 1.2 10.6 2.3 12 4.1C13.4 2.3 15.3 1.2 17.6 1.5C21.5 2.1 23.3 6.3 21.6 9.7C19.8 13.4 13.1 19.1 12 20.1Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
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

function MenuIcon({ type }: { type: "catalog" | "favorite" | "partner" | "login" }) {
  const common = { width: 21, height: 21, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true } as const;

  if (type === "catalog") {
    return <svg {...common}><path d="M4 5.5H20M4 12H20M4 18.5H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
  }
  if (type === "favorite") return <HeartIcon filled={false} />;
  if (type === "partner") {
    return <svg {...common}><path d="M8.3 12.2L10.4 10.1C11.3 9.2 12.7 9.2 13.6 10.1L15 11.5C15.8 12.3 17.1 12.3 17.9 11.5L20 9.4M3.8 12.4L7.5 16.1C8.4 17 9.8 17 10.7 16.1L11.5 15.3M20.2 12.4L16.5 16.1C15.6 17 14.2 17 13.3 16.1L9.4 12.2M4 9.2L7.2 6H10M20 9.2L16.8 6H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  return <svg {...common}><path d="M4 12H16M12 7L17 12L12 17M19 4H21V20H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function PublicHeader({ backHref, backLabel = "Назад", className = "" }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
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

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyBrowserTheme(next);
  }

  return (
    <>
      <header className={`ac-public-header sticky top-0 z-50 bg-[#070a12]/90 backdrop-blur-xl ${className}`}>
        <div className="mx-auto flex h-16 w-full max-w-[1500px] items-center justify-between gap-3 px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            {backHref ? (
              <Link
                href={backHref}
                className="flex h-10 items-center gap-2 rounded-xl bg-white/[0.055] px-3 text-sm font-black text-white/72 transition hover:bg-white/[0.09] hover:text-white"
              >
                <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M15 9H3M7 5L3 9L7 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="hidden sm:inline">{backLabel}</span>
              </Link>
            ) : null}

            <Link href="/" className="flex min-w-0 items-center gap-2.5">
              <BrandMark className="h-9 w-9 shrink-0 md:h-10 md:w-10" />
              <div className="min-w-0">
                <div className="text-[18px] font-black leading-none md:text-[22px]">
                  <span className="text-red-500">Авто</span>
                  <span className="text-white">Цена</span>
                </div>
                <div className="text-[11px] font-bold leading-none text-white/42">подбор · расчёт</div>
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-1.5 md:gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="ac-icon-button hidden h-11 w-11 items-center justify-center rounded-xl bg-white/[0.045] text-amber-300 transition hover:bg-white/[0.085] md:flex"
              aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
              title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
            >
              <ThemeIcon theme={theme} />
            </button>

            <Link
              href="/favorites"
              className="ac-favorite-header relative flex h-11 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-500 transition hover:bg-red-500/16"
              aria-label="Избранные автомобили"
            >
              <HeartIcon />
              {favoritesCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
                  {Math.min(favoritesCount, 99)}
                </span>
              ) : null}
            </Link>

            <nav className="hidden items-center gap-1 text-sm font-black text-white/72 md:flex">
              <Link href="/cars" className="rounded-xl px-4 py-3 transition hover:bg-white/[0.06] hover:text-white">Каталог</Link>
              <Link href="/partner/landing" className="rounded-xl px-4 py-3 transition hover:bg-white/[0.06] hover:text-white">Партнёрам</Link>
              <Link href="/login" className="rounded-xl px-4 py-3 transition hover:bg-white/[0.06] hover:text-white">Вход</Link>
            </nav>

            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="flex h-11 w-11 items-center justify-center text-white/84 md:hidden"
              aria-label="Открыть меню"
            >
              <svg width="25" height="19" viewBox="0 0 25 19" fill="none" aria-hidden="true">
                <path d="M2 2H23M2 9.5H23M2 17H23" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 z-[9999] md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/72 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
            aria-label="Закрыть меню"
          />
          <aside className="ac-mobile-drawer absolute right-0 top-0 h-full w-[min(330px,88vw)] bg-[#0d1018] p-5 shadow-[-30px_0_100px_rgba(0,0,0,.65)]">
            <div className="flex items-center justify-between gap-3">
              <Link href="/" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5">
                <BrandMark className="h-9 w-9" />
                <div>
                  <div className="font-black"><span className="text-red-500">Авто</span><span className="text-white">Цена</span></div>
                  <div className="text-[11px] font-bold text-white/38">меню</div>
                </div>
              </Link>
              <button type="button" onClick={() => setMenuOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.05] text-white/72" aria-label="Закрыть">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 3L15 15M15 3L3 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
              </button>
            </div>

            <nav className="mt-8 grid gap-2 text-base font-black">
              <Link onClick={() => setMenuOpen(false)} href="/cars" className="ac-drawer-nav-link flex items-center justify-between rounded-2xl bg-white/[0.055] px-5 py-4">
                <span>Каталог</span><span className="text-red-400"><MenuIcon type="catalog" /></span>
              </Link>
              <Link onClick={() => setMenuOpen(false)} href="/favorites" className="ac-drawer-nav-link flex items-center justify-between rounded-2xl bg-white/[0.055] px-5 py-4">
                <span>Избранное {favoritesCount ? `· ${favoritesCount}` : ""}</span><span className="text-red-500"><MenuIcon type="favorite" /></span>
              </Link>
              <Link onClick={() => setMenuOpen(false)} href="/partner/landing" className="ac-drawer-nav-link flex items-center justify-between rounded-2xl bg-white/[0.055] px-5 py-4">
                <span>Партнёрам</span><span className="text-red-400"><MenuIcon type="partner" /></span>
              </Link>
              <button type="button" onClick={toggleTheme} className="ac-drawer-nav-link flex items-center justify-between rounded-2xl bg-white/[0.055] px-5 py-4 text-left">
                <span>{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</span><span className="text-amber-300"><ThemeIcon theme={theme} /></span>
              </button>
              <Link onClick={() => setMenuOpen(false)} href="/login" className="flex items-center justify-between rounded-2xl bg-red-600 px-5 py-4 text-white">
                <span>Вход</span><span><MenuIcon type="login" /></span>
              </Link>
            </nav>

            <div className="mt-6 rounded-2xl bg-white/[0.035] p-4 text-sm font-medium leading-6 text-white/48">
              Для менеджеров и партнёров. CRM и API доступны после входа.
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
