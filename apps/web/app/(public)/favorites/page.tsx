"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { FavoriteToggle } from "@/components/catalog/FavoriteToggle";

const FAVORITES_KEY = "avtocena_favorites";

type Favorite = {
  id: string;
  title?: string;
  price?: number | null;
  imageUrl?: string;
  year?: number;
  mileageKm?: number;
  marketLabel?: string;
  href?: string;
};

function readFavorites(): Favorite[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function money(value?: number | null) {
  return value ? `${new Intl.NumberFormat("ru-RU").format(value)} ₽` : "Цена уточняется";
}

export default function FavoritesPage() {
  const [items, setItems] = useState<Favorite[]>([]);

  useEffect(() => {
    const update = () => setItems(readFavorites());
    update();
    window.addEventListener("avtocena:favorites-changed", update as EventListener);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("avtocena:favorites-changed", update as EventListener);
      window.removeEventListener("storage", update);
    };
  }, []);

  return (
    <main className="ac-page-copy min-h-screen bg-[#07080d] text-white">
      <PublicHeader backHref="/" backLabel="На главную" />
      <section className="mx-auto w-full max-w-6xl px-4 py-10 md:px-8">
        <h1 className="text-4xl font-black tracking-[-0.04em] md:text-6xl">Избранные автомобили</h1>
        <p className="mt-3 max-w-2xl text-white/58">Сохраняйте варианты красным сердцем и возвращайтесь к ним позже.</p>

        {items.length ? (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <article key={item.id} className="ac-favorites-card relative overflow-hidden rounded-[1.5rem] bg-white/[0.045]">
                <Link href={item.href || `/cars/offer/${item.id}`}>
                  <div className="h-52 bg-white/[0.04]">
                    {item.imageUrl ? <img src={item.imageUrl} alt={item.title || "Автомобиль"} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm font-bold text-white/35">Фото загружается</div>}
                  </div>
                  <div className="p-4">
                    <div className="text-xs font-black uppercase tracking-[0.15em] text-red-300">{item.marketLabel || "Каталог"}</div>
                    <h2 className="mt-2 text-xl font-black">{item.title || "Автомобиль"}</h2>
                    <div className="mt-2 text-sm text-white/55">{item.year || "—"} · {item.mileageKm ? `${new Intl.NumberFormat("ru-RU").format(item.mileageKm)} км` : "пробег уточняется"}</div>
                    <div className="mt-4 text-2xl font-black text-red-300">{money(item.price)}</div>
                  </div>
                </Link>
                <FavoriteToggle offerId={item.id} snapshot={item} className="absolute right-3 top-3" />
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-10 rounded-[2rem] bg-white/[0.045] p-8 text-center shadow-[0_18px_60px_rgba(0,0,0,.18)]">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
              <svg width="32" height="29" viewBox="0 0 24 22" fill="none" aria-hidden="true"><path d="M12 20.1C10.9 19.1 4.2 13.4 2.4 9.7C.7 6.3 2.5 2.1 6.4 1.5C8.7 1.2 10.6 2.3 12 4.1C13.4 2.3 15.3 1.2 17.6 1.5C21.5 2.1 23.3 6.3 21.6 9.7C19.8 13.4 13.1 19.1 12 20.1Z" stroke="currentColor" strokeWidth="1.8" /></svg>
            </div>
            <h2 className="mt-4 text-2xl font-black">Пока ничего не сохранено</h2>
            <p className="mt-2 text-white/55">Нажмите красное сердечко на карточке автомобиля.</p>
            <Link href="/cars" className="avto-button mt-6 inline-block rounded-2xl px-6 py-4 font-black">Открыть каталог</Link>
          </div>
        )}
      </section>
    </main>
  );
}
