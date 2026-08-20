"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BrandLogoVisual } from "@/components/catalog/BrandLogoRail";

export type AutocatalogBrandItem = {
  name: string;
  slug: string;
  aliases: string[];
  modelCount: number;
  offerCount: number;
};

function searchable(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function groupLetter(name: string) {
  const first = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[A-Za-z]/)?.[0];
  return first ? first.toUpperCase() : "#";
}

function modelWord(count: number) {
  const tail = count % 100;
  const last = count % 10;
  if (tail >= 11 && tail <= 19) return "моделей";
  if (last === 1) return "модель";
  if (last >= 2 && last <= 4) return "модели";
  return "моделей";
}

export function AutocatalogBrandDirectory({ brands }: { brands: AutocatalogBrandItem[] }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = searchable(query);
  const allLetters = useMemo(() => [...new Set(brands.map((brand) => groupLetter(brand.name)))].sort((a, b) => a === "#" ? -1 : b === "#" ? 1 : a.localeCompare(b, "en")), [brands]);
  const filtered = useMemo(() => {
    if (!normalizedQuery) return brands;
    return brands.filter((brand) => [brand.name, ...brand.aliases].some((value) => searchable(value).includes(normalizedQuery)));
  }, [brands, normalizedQuery]);
  const grouped = useMemo(() => {
    const rows = new Map<string, AutocatalogBrandItem[]>();
    for (const brand of filtered) rows.set(groupLetter(brand.name), [...(rows.get(groupLetter(brand.name)) || []), brand]);
    return [...rows.entries()].sort(([left], [right]) => left === "#" ? -1 : right === "#" ? 1 : left.localeCompare(right, "en"));
  }, [filtered]);

  return <section className="mt-7" aria-labelledby="autocatalog-brands-title">
    <div className="sticky top-[72px] z-20 rounded-[1.6rem] border border-black/5 bg-[var(--ac-surface)]/95 p-3 backdrop-blur-xl dark:border-white/5 md:p-4">
      <label className="flex min-h-14 items-center gap-3 rounded-2xl bg-[var(--ac-surface-2)] px-4 text-[var(--ac-muted)] focus-within:ring-2 focus-within:ring-red-500/35">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.9" /><path d="m16 16 4.3 4.3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Марка на русском, английском, китайском, японском или корейском"
          className="h-14 min-w-0 flex-1 bg-transparent text-sm font-bold text-[var(--ac-text)] outline-none placeholder:text-[var(--ac-muted)]"
          aria-label="Найти марку в автокаталоге"
        />
        {query ? <button type="button" onClick={() => setQuery("")} className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ac-surface-3)] text-lg font-bold" aria-label="Очистить поиск">×</button> : null}
      </label>
      <div className="ac-hide-scrollbar mt-3 flex gap-1 overflow-x-auto pb-0.5" aria-label="Алфавит марок">
        {allLetters.map((letter) => <a
          key={letter}
          href={`#brands-${letter === "#" ? "number" : letter.toLowerCase()}`}
          className={`flex h-9 min-w-9 shrink-0 items-center justify-center rounded-xl px-2 text-xs font-black transition ${grouped.some(([group]) => group === letter) ? "bg-[var(--ac-surface-2)] text-[var(--ac-text)] hover:bg-red-500 hover:text-white" : "pointer-events-none text-[var(--ac-muted)] opacity-30"}`}
        >{letter}</a>)}
      </div>
    </div>

    <div className="mt-5 flex items-end justify-between gap-3">
      <div><div className="text-xs font-black uppercase tracking-[0.16em] text-red-500">База марок</div><h2 id="autocatalog-brands-title" className="mt-1 text-3xl font-black md:text-5xl">{normalizedQuery ? `Найдено: ${filtered.length}` : "Все марки по алфавиту"}</h2></div>
      <div className="text-right text-xs font-bold text-[var(--ac-muted)]">{brands.length.toLocaleString("ru-RU")} канонических марок</div>
    </div>

    {grouped.length ? <div className="mt-5 space-y-8">
      {grouped.map(([letter, rows]) => <section key={letter} id={`brands-${letter === "#" ? "number" : letter.toLowerCase()}`} className="scroll-mt-52 rounded-[1.7rem] bg-[var(--ac-surface)] p-4 md:p-5">
        <div className="flex items-center gap-3 border-b border-black/5 pb-3 dark:border-white/5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500 text-xl font-black text-white">{letter}</div>
          <div className="text-sm font-bold text-[var(--ac-muted)]">{rows.length} {rows.length === 1 ? "марка" : rows.length >= 2 && rows.length <= 4 ? "марки" : "марок"}</div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((brand) => <Link
            key={brand.slug}
            href={`/cars/brand/${brand.slug}`}
            className="group flex min-h-[78px] min-w-0 items-center gap-3 rounded-2xl bg-[var(--ac-surface-2)] px-3 py-2.5 transition hover:-translate-y-0.5 hover:bg-[var(--ac-surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/45"
          >
            <span className="flex h-14 w-[82px] shrink-0 items-center justify-center rounded-xl bg-[var(--ac-surface)]">
              <BrandLogoVisual brand={brand.name} className="!h-10 !w-[70px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-black text-[var(--ac-text)] transition group-hover:text-red-500">{brand.name}</span>
              <span className="mt-1 block text-[11px] font-bold text-[var(--ac-muted)]">{brand.modelCount.toLocaleString("ru-RU")} {modelWord(brand.modelCount)}{brand.offerCount ? ` · ${brand.offerCount.toLocaleString("ru-RU")} в продаже` : ""}</span>
            </span>
            <span className="shrink-0 text-lg font-black text-red-500">→</span>
          </Link>)}
        </div>
      </section>)}
    </div> : <div className="mt-5 rounded-[1.7rem] bg-[var(--ac-surface)] p-8 text-center">
      <div className="text-xl font-black">Марка не найдена</div>
      <p className="mt-2 text-sm font-bold text-[var(--ac-muted)]">Попробуйте другое написание — поиск учитывает проверенные локальные названия и алиасы.</p>
    </div>}
  </section>;
}
