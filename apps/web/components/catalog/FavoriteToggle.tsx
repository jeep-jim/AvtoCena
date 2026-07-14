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
};

function readFavorites(): FavoriteSnapshot[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id) : [];
  } catch {
    return [];
  }
}

export function FavoriteToggle({ offerId, snapshot, className = "", compact = false }: Props) {
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
      : [
          {
            id: offerId,
            href: `/cars/offer/${offerId}`,
            ...snapshot,
          },
          ...current,
        ];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next.slice(0, 100)));
    setActive(!exists);
    window.dispatchEvent(new CustomEvent("avtocena:favorites-changed"));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`${compact ? "h-10 w-10" : "h-11 w-11"} flex shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/35 text-xl backdrop-blur transition hover:border-red-300/35 hover:bg-black/55 ${active ? "text-red-400" : "text-white/72"} ${className}`}
      aria-label={active ? "Убрать из избранного" : "Добавить в избранное"}
      title={active ? "Убрать из избранного" : "Добавить в избранное"}
    >
      {active ? "♥" : "♡"}
    </button>
  );
}
