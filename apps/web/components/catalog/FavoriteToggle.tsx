"use client";

import { useEffect, useState } from "react";

const FAVORITES_KEY = "avtocena_favorites";

type FavoriteSnapshot = {
  id: string;
  title?: string;
  price?: number | null;
  imageUrl?: string;
  year?: number;
  mileageKm?: number;
  marketLabel?: string;
  href?: string;
};

type Props = {
  offerId: string;
  snapshot?: FavoriteSnapshot;
  className?: string;
  compact?: boolean;
  plain?: boolean;
};

function readFavorites(): FavoriteSnapshot[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id) : [];
  } catch {
    return [];
  }
}

function StarIcon({ active, size = 24 }: { active: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} aria-hidden="true">
      <path d="M12 2.8L14.8 8.5L21.1 9.4L16.5 13.8L17.6 20.1L12 17.2L6.4 20.1L7.5 13.8L2.9 9.4L9.2 8.5L12 2.8Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
    </svg>
  );
}

export function FavoriteToggle({ offerId, snapshot, className = "", compact = false, plain = false }: Props) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(readFavorites().some((item) => item.id === offerId));
  }, [offerId]);

  function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const current = readFavorites();
    const exists = current.some((item) => item.id === offerId);
    const next = exists
      ? current.filter((item) => item.id !== offerId)
      : [{ id: offerId, href: `/cars/offer/${offerId}`, ...snapshot }, ...current];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next.slice(0, 100)));
    setActive(!exists);
    window.dispatchEvent(new CustomEvent("avtocena:favorites-changed"));
  }

  const sizing = plain ? "h-9 w-9" : compact ? "h-10 w-10" : "h-12 w-12";
  const surface = plain
    ? "bg-transparent shadow-none hover:bg-white/[0.055]"
    : "bg-black/38 shadow-[0_8px_26px_rgba(0,0,0,.25)] backdrop-blur hover:bg-black/58";

  return (
    <button
      type="button"
      onClick={toggle}
      className={`${sizing} ac-favorite-button flex shrink-0 items-center justify-center rounded-xl text-red-500 transition active:scale-95 ${surface} ${className}`}
      aria-label={active ? "Убрать из избранного" : "Добавить в избранное"}
      title={active ? "Убрать из избранного" : "Добавить в избранное"}
    >
      <StarIcon active={active} size={plain ? 27 : compact ? 23 : 25} />
    </button>
  );
}
