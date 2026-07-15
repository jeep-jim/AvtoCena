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
  inline?: boolean;
};

function readFavorites(): FavoriteSnapshot[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id) : [];
  } catch {
    return [];
  }
}

function StarIcon({ active }: { active: boolean }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} aria-hidden="true"><path d="M12 2.7L14.85 8.5L21.25 9.43L16.62 13.94L17.71 20.31L12 17.31L6.29 20.31L7.38 13.94L2.75 9.43L9.15 8.5L12 2.7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>;
}

export function FavoriteToggle({ offerId, snapshot, className = "", compact = false, inline = false }: Props) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(readFavorites().some((item) => item.id === offerId));
  }, [offerId]);

  function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const current = readFavorites();
    const exists = current.some((item) => item.id === offerId);
    const next = exists ? current.filter((item) => item.id !== offerId) : [{ id: offerId, href: `/cars/offer/${offerId}`, ...snapshot }, ...current];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next.slice(0, 100)));
    setActive(!exists);
    window.dispatchEvent(new CustomEvent("avtocena:favorites-changed"));
  }

  const size = inline ? "h-8 w-8 align-middle" : compact ? "h-10 w-10" : "h-11 w-11";
  const surface = inline || compact ? "bg-transparent" : "bg-black/20 backdrop-blur";

  return <button type="button" onClick={toggle} className={`${size} ac-favorite-button inline-flex shrink-0 items-center justify-center rounded-lg text-red-500 transition hover:text-red-400 active:scale-95 ${surface} ${className}`} aria-label={active ? "Убрать из избранного" : "Добавить в избранное"} title={active ? "Убрать из избранного" : "Добавить в избранное"}><StarIcon active={active} /></button>;
}
