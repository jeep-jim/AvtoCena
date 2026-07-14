"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";

const FAVORITES_KEY = "avtocena_favorites";

type Props = {
  backHref?: string;
  backLabel?: string;
  className?: string;
};

function readCount() {
  try {
    const items = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(items) ? items.length : 0;
  } catch {
    return 0;
  }
}

export function PublicHeader({ backHref, backLabel = "Назад", className = "" }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [favoritesCount, setFavoritesCount] = useState(0);

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
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  return (
    <>
      <header className={`sticky top-0 z-50 border-b border-white/8 bg-[#070a12]/88 backdrop-blur-xl ${className}`}>
        <div className="mx-auto flex h-16 w-full max-w-[1500px] items-center justify-between gap-4 px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            {backHref ? (
              <Link
                href={backHref}
                className="flex h-10 items-center gap-2 rounded-xl bg-white/[0.055] px-3 text-sm font-black text-white/72 transition hover:bg-white/[0.09] hover:text-white"
              >
                <span aria-hidden="true">←</span>
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

          <div className="flex items-center gap-2">
            <Link
              href="/favorites"
              className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.045] text-red-400 transition hover:bg-white/[0.09] hover:text-red-300"
              aria-label="Избранные автомобили"
            >
              <span className="text-[22px] leading-none">♥</span>
              {favoritesCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
                  {Math.min(favoritesCount, 99)}
                </span>
              ) : null}
            </Link>

            <nav className="hidden items-center gap-1 text-sm font-black text-white/72 md:flex">
              <Link href="/cars" className="rounded-xl px-4 py-3 transition hover:bg-white/[0.07] hover:text-white">Каталог</Link>
              <Link href="/partner/landing" className="rounded-xl px-4 py-3 transition hover:bg-white/[0.07] hover:text-white">Партнёрам</Link>
              <Link href="/login" className="rounded-xl px-4 py-3 transition hover:bg-white/[0.07] hover:text-white">Вход</Link>
            </nav>

            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="flex h-11 w-11 items-center justify-center text-white/84 md:hidden"
              aria-label="Открыть меню"
            >
              <svg width="24" height="18" viewBox="0 0 24 18" fill="none" aria-hidden="true">
                <path d="M2 2H22M2 9H22M2 16H22" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 z-[9999] md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
            aria-label="Закрыть меню"
          />
          <aside className="absolute right-0 top-0 h-full w-[min(330px,88vw)] border-l border-white/10 bg-[#0d1018] p-5 shadow-[-30px_0_100px_rgba(0,0,0,.65)]">
            <div className="flex items-center justify-between">
              <Link href="/" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5">
                <BrandMark className="h-9 w-9" />
                <div className="font-black"><span className="text-red-500">Авто</span>Цена</div>
              </Link>
              <button type="button" onClick={() => setMenuOpen(false)} className="flex h-10 w-10 items-center justify-center text-2xl text-white/72" aria-label="Закрыть">×</button>
            </div>
            <nav className="mt-8 grid gap-2 text-base font-black">
              <Link onClick={() => setMenuOpen(false)} href="/cars" className="rounded-2xl bg-white/[0.055] px-5 py-4">Каталог</Link>
              <Link onClick={() => setMenuOpen(false)} href="/favorites" className="rounded-2xl bg-white/[0.055] px-5 py-4">Избранное {favoritesCount ? `· ${favoritesCount}` : ""}</Link>
              <Link onClick={() => setMenuOpen(false)} href="/partner/landing" className="rounded-2xl bg-white/[0.055] px-5 py-4">Партнёрам</Link>
              <Link onClick={() => setMenuOpen(false)} href="/login" className="rounded-2xl bg-red-600 px-5 py-4">Вход</Link>
            </nav>
          </aside>
        </div>
      ) : null}
    </>
  );
}
