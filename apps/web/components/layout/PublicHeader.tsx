"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

function updateBrowserChrome(theme: Theme) {
  const color = theme === "light" ? "#ffffff" : "#07080d";
  let themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!themeColor) {
    themeColor = document.createElement("meta");
    themeColor.name = "theme-color";
    document.head.appendChild(themeColor);
  }
  themeColor.content = color;

  let statusBar = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (!statusBar) {
    statusBar = document.createElement("meta");
    statusBar.name = "apple-mobile-web-app-status-bar-style";
    document.head.appendChild(statusBar);
  }
  statusBar.content = theme === "light" ? "default" : "black-translucent";
  document.documentElement.style.colorScheme = theme;
}

function applyBrowserTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  updateBrowserChrome(theme);

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
  const pathname = usePathname();
  const [favoritesCount, setFavoritesCount] = useState(0);
  const [theme, setTheme] = useState<Theme>("dark");
  const catalogActive = pathname === "/cars" || pathname.startsWith("/cars/");

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
    <>
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
              <Link href="/cars" className={`ac-catalog-nav flex h-11 items-center gap-2 rounded-xl px-4 transition ${catalogActive ? "is-active" : ""}`} aria-current={catalogActive ? "page" : undefined}>
                <CarIcon />
                <span>Каталог</span>
              </Link>
            </nav>

            <Link href="/cars" className={`ac-catalog-nav ac-icon-button flex h-11 w-11 items-center justify-center rounded-xl transition md:hidden ${catalogActive ? "is-active" : ""}`} aria-label="Открыть каталог" aria-current={catalogActive ? "page" : undefined} title="Каталог">
              <CarIcon />
            </Link>
          </div>
        </div>
      </header>

      <style jsx global>{`
        .ac-catalog-nav { background: rgba(255,255,255,.045); color: rgba(255,255,255,.84); }
        .ac-catalog-nav:hover { background: rgba(255,255,255,.085); color: #fff; }
        .ac-catalog-nav.is-active { background: #ff353d !important; color: #fff !important; }

        .ac-filter-control,
        .ac-filter-range,
        .ac-filter-more-button {
          border: 1px solid rgba(255,255,255,.085);
          background: rgba(255,255,255,.065);
          color: #fff;
          transition: background .18s ease, border-color .18s ease, transform .18s ease;
        }
        .ac-filter-control:hover { background: rgba(255,255,255,.09); border-color: rgba(255,255,255,.14); }
        .ac-filter-control:focus-visible { outline: none; border-color: rgba(255,70,80,.58); box-shadow: 0 0 0 4px rgba(255,53,61,.11); }
        .ac-filter-range > input + input { border-left: 1px solid rgba(255,255,255,.08); }
        .ac-filter-dropdown { background: #171922; color: #fff; border: 1px solid rgba(255,70,80,.3); }
        .ac-filter-search { background: rgba(255,255,255,.07); color: #fff; border: 1px solid rgba(255,255,255,.08); }
        .ac-filter-search::placeholder { color: rgba(255,255,255,.35); }
        .ac-filter-option { color: rgba(255,255,255,.8); }
        .ac-filter-option:hover { background: rgba(255,255,255,.07); color: #fff; }
        .ac-filter-option.is-active { background: #ff353d; color: #fff; }
        .ac-catalog-filter-panel { background: linear-gradient(145deg, rgba(255,255,255,.07), rgba(255,255,255,.035)) !important; }
        .ac-advanced-toggle { color: rgba(255,255,255,.55); background: rgba(255,255,255,.035); }
        .ac-advanced-toggle:hover { color: #fff; background: rgba(255,255,255,.065); }
        .ac-advanced-fields { background: rgba(0,0,0,.16); }
        .ac-catalog-filter-drawer { background: #14151b; color: #fff; }
        .ac-filter-close { background: rgba(255,255,255,.06); color: rgba(255,255,255,.62); }

        #form .soft-input,
        #form .ac-search-select {
          border: 1px solid rgba(255,255,255,.085) !important;
          background-color: rgba(255,255,255,.07) !important;
        }
        #form .ac-body-picker-panel {
          grid-template-columns: repeat(2,minmax(0,1fr)) !important;
          gap: 6px !important;
        }
        #form .ac-body-picker-panel svg { display: none !important; }
        #form .ac-body-picker-panel button {
          min-height: 46px !important;
          flex-direction: row !important;
          justify-content: flex-start !important;
          padding: 0 14px !important;
          font-size: 13px !important;
          text-align: left !important;
        }
        #form .ac-body-picker-panel button span { margin-top: 0 !important; }
        section[data-demo-enabled] > div:first-child > div:last-child > div:first-child .ac-search-menu > div:first-child { display: none !important; }

        html[data-theme="light"] .ac-catalog-nav { background: #e7eaf0; color: #4d5667; }
        html[data-theme="light"] .ac-catalog-nav:hover { background: #dde2e9; color: #1e232d; }
        html[data-theme="light"] .ac-catalog-nav.is-active { background: #ff353d !important; color: #fff !important; }
        html[data-theme="light"] .ac-filter-control,
        html[data-theme="light"] .ac-filter-range,
        html[data-theme="light"] .ac-filter-more-button {
          border-color: rgba(35,42,55,.12);
          background: #e7eaf0;
          color: #20252f;
        }
        html[data-theme="light"] .ac-filter-control:hover { background: #dde2e9; border-color: rgba(35,42,55,.2); }
        html[data-theme="light"] .ac-filter-range > input + input { border-left-color: rgba(35,42,55,.12); }
        html[data-theme="light"] .ac-filter-range input { color: #20252f !important; }
        html[data-theme="light"] .ac-filter-range input::placeholder { color: #737c8c !important; }
        html[data-theme="light"] .ac-catalog-filter-panel { background: rgba(255,255,255,.72) !important; }
        html[data-theme="light"] .ac-advanced-toggle { color: #596274; background: #e8ebf1; }
        html[data-theme="light"] .ac-advanced-toggle:hover { color: #20252f; background: #dfe4eb; }
        html[data-theme="light"] .ac-advanced-fields { background: #eef1f5; }
        html[data-theme="light"] .ac-catalog-filter-drawer { background: #f6f7fa; color: #20252f; }
        html[data-theme="light"] .ac-filter-close { background: #e4e8ef; color: #596274; }

        @media (max-width: 767px) {
          #form .ac-body-picker-panel { grid-template-columns: 1fr !important; }
          #form .ac-body-picker-panel button { min-height: 44px !important; }
        }
      `}</style>
    </>
  );
}
