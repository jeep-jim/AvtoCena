"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type BrandModelLink = {
  id: string;
  model: string;
  slug: string;
  count: number;
  aliases?: string[];
};

const PREVIEW_LIMIT = 12;

function searchable(value: unknown) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function SearchIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.9" />
    <path d="m16 16 4.3 4.3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>;
}

export function BrandModelDirectory({
  brand,
  brandSlug,
  models,
}: {
  brand: string;
  brandSlug: string;
  models: BrandModelLink[];
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const normalizedQuery = searchable(query);

  const liveModels = useMemo(
    () => models.filter((model) => model.count > 0),
    [models],
  );

  const filtered = useMemo(() => {
    if (!normalizedQuery) {
      const priority = liveModels.length ? liveModels : models;
      return expanded ? models : priority.slice(0, PREVIEW_LIMIT);
    }
    return models.filter((model) => {
      const values = [model.model, ...(model.aliases || [])];
      return values.some((value) => searchable(value).includes(normalizedQuery));
    });
  }, [expanded, liveModels, models, normalizedQuery]);

  const canExpand = !normalizedQuery && models.length > filtered.length;

  return <section className="mt-7 rounded-[1.8rem] bg-[var(--ac-surface)] p-5 md:p-7">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="text-xs font-black uppercase tracking-[0.16em] text-red-500">Модельный ряд</div>
        <h2 className="mt-1 text-2xl font-black md:text-4xl">Модели {brand}</h2>
      </div>
      {!normalizedQuery && (canExpand || expanded) ? <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="ac-market-all-link shrink-0 text-sm font-black"
      >
        {expanded ? "Свернуть ↑" : "Все →"}
      </button> : null}
    </div>

    <label className="mt-5 flex h-12 w-full max-w-xl items-center gap-3 rounded-2xl bg-[var(--ac-surface-2)] px-4 text-[var(--ac-muted)] focus-within:ring-2 focus-within:ring-red-500/35">
      <SearchIcon />
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Найти модель ${brand}`}
        className="h-full min-w-0 flex-1 bg-transparent text-sm font-bold text-[var(--ac-text)] outline-none placeholder:text-[var(--ac-muted)]"
        aria-label={`Найти модель ${brand}`}
      />
      {query ? <button type="button" onClick={() => setQuery("")} className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ac-surface-3)] text-lg font-bold" aria-label="Очистить поиск">×</button> : null}
    </label>

    {filtered.length ? <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {filtered.map((model) => <Link
        key={model.id}
        href={`/cars/brand/${brandSlug}/model/${model.slug}`}
        className="group flex min-h-11 items-center justify-between gap-2 rounded-2xl bg-[var(--ac-surface-2)] px-3 py-2.5 text-sm font-black transition hover:bg-[var(--ac-surface-3)] hover:text-red-500"
      >
        <span className="min-w-0 truncate">{model.model}</span>
        {model.count > 0 ? <span className="shrink-0 text-[10px] font-black text-[var(--ac-muted)]">{model.count}</span> : null}
      </Link>)}
    </div> : normalizedQuery ? <p className="mt-5 text-sm font-bold text-[var(--ac-muted)]">Такой модели в списке нет.</p> : null}
  </section>;
}
