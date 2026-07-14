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

function HeartIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="22" viewBox="0 0 24 22" fill={active ? "currentColor" : "none"} aria-hidden="true">
      <path
        d="M12 20.1C10.9 19.1 4.2 13.4 2.4 9.7C.7 6.3 2.5 2.1 6.4 1.5C8.7 1.2 10.6 2.3 12 4.1C13.4 2.3 15.3 1.2 17.6 1.5C21.5 2.1 23.3 6.3 21.6 9.7C19.8 13.4 13.1 19.1 12 20.1Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
    </svg>
  );
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
      className={`${compact ? "h-11 w-12" : "h-12 w-13"} flex shrink-0 items-center justify-center rounded-xl bg-black/38 text-red-500 shadow-[0_8px_26px_rgba(0,0,0,.25)] backdrop-blur transition hover:bg-black/58 hover:text-red-400 active:scale-95 ${className}`}
      aria-label={active ? "Убрать из избранного" : "Добавить в избранное"}
      title={active ? "Убрать из избранного" : "Добавить в избранное"}
    >
      <HeartIcon active={active} />
    </button>
  );
}
