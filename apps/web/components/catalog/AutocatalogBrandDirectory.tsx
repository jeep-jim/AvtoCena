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
    <div className="sticky top-[64px] z-20 -mx-4 border-y border-white/5 bg-[#07080d]/95 px-4 py-2.5 backdrop-blur-xl md:-mx-8 md:px-8">
      <label className="flex min-h-12 items-center gap-3 rounded-xl bg-[var(--ac-surface-2)] px-3 text-[var(--ac-muted)] focus-within:ring-2 focus-within:ring-red-500/35 md:px-4">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.9" /><path d="m16 16 4.3 4.3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти марку"
          className="h-12 min-w-0 flex-1 bg-transparent text-sm font-bold text-[var(--ac-text)] outline-none placeholder:text-[var(--ac-muted)]"
          aria-label="Найти марку в автокаталоге"
        />
        {query ? <button type="button" onClick={() => setQuery("")} className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ac-surface-3)] text-lg font-bold" aria-label="Очистить поиск">×</button> : null}
      </label>
      <div className="mt-2 grid w-full grid-cols-[repeat(auto-fit,minmax(32px,1fr))] gap-1" aria-label="Алфавит марок">
        {allLetters.map((letter) => <a
          key={letter}
          href={`#brands-${letter === "#" ? "number" : letter.toLowerCase()}`}
          className={`flex h-8 min-w-0 items-center justify-center rounded-lg px-1 text-[11px] font-black transition md:h-9 md:text-xs ${grouped.some(([group]) => group === letter) ? "bg-red-500 text-white hover:bg-red-600" : "pointer-events-none bg-[var(--ac-surface-2)] text-[var(--ac-muted)] opacity-25"}`}
        >{letter}</a>)}
      </div>
    </div>

    <div className="mt-7">
      <div className="text-xs font-black uppercase tracking-[0.16em] text-red-500">База марок</div>
      <h2 id="autocatalog-brands-title" className="mt-1 text-3xl font-black md:text-5xl">{normalizedQuery ? `Найдено: ${filtered.length}` : "Все марки по алфавиту"}</h2>
    </div>

    {grouped.length ? <div className="mt-5 space-y-9">
      {grouped.map(([letter, rows]) => <section key={letter} id={`brands-${letter === "#" ? "number" : letter.toLowerCase()}`} className="scroll-mt-44">
        <div className="flex items-center gap-3 border-b border-white/8 pb-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500 text-lg font-black text-white">{letter}</div>
          <div className="text-xs font-bold text-[var(--ac-muted)]">{rows.length} {rows.length === 1 ? "марка" : rows.length >= 2 && rows.length <= 4 ? "марки" : "марок"}</div>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((brand) => <Link
            key={brand.slug}
            href={`/cars/brand/${brand.slug}`}
            className="group flex min-h-[68px] min-w-0 items-center gap-2.5 rounded-xl bg-[var(--ac-surface-2)] px-2.5 py-2 transition hover:bg-[var(--ac-surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/45 md:min-h-[72px] md:px-3"
          >
            <span className="flex h-12 w-[70px] shrink-0 items-center justify-center">
              <BrandLogoVisual brand={brand.name} className="!h-9 !w-[64px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-black text-[var(--ac-text)] transition group-hover:text-red-500 md:text-base">{brand.name}</span>
              <span className="mt-0.5 block text-[10px] font-bold text-[var(--ac-muted)] md:text-[11px]">{brand.modelCount.toLocaleString("ru-RU")} {modelWord(brand.modelCount)}{brand.offerCount ? ` · ${brand.offerCount.toLocaleString("ru-RU")} в продаже` : ""}</span>
            </span>
            <span className="shrink-0 text-base font-black text-red-500">→</span>
          </Link>)}
        </div>
      </section>)}
    </div> : <div className="mt-8 py-8 text-center">
      <div className="text-xl font-black">Марка не найдена</div>
      <p className="mt-2 text-sm font-bold text-[var(--ac-muted)]">Попробуйте другое написание.</p>
    </div>}
  </section>;
}
