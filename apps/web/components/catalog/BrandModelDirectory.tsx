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

const PREVIEW_LIMIT = 6;

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

function Chevron({ open = false }: { open?: boolean }) {
  return <svg className={`shrink-0 transition ${open ? "rotate-180" : ""}`} width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

  const prioritizedModels = useMemo(() => {
    const live = models.filter((model) => model.count > 0);
    const remaining = models.filter((model) => model.count <= 0);
    return [...live, ...remaining];
  }, [models]);

  const filtered = useMemo(() => {
    if (!normalizedQuery) return expanded ? prioritizedModels : prioritizedModels.slice(0, PREVIEW_LIMIT);
    return models.filter((model) => {
      const values = [model.model, ...(model.aliases || [])];
      return values.some((value) => searchable(value).includes(normalizedQuery));
    });
  }, [expanded, models, normalizedQuery, prioritizedModels]);

  const canExpand = !normalizedQuery && models.length > PREVIEW_LIMIT;

  return <section className="mt-7 rounded-[1.8rem] bg-[var(--ac-surface)] p-5 md:p-7">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-2xl font-black md:text-4xl">Модели {brand}</h2>
      {canExpand ? <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="ac-market-all-link inline-flex shrink-0 items-center gap-1.5 text-sm font-black"
        aria-expanded={expanded}
      >
        <span>{expanded ? "Свернуть" : `Все · ${models.length}`}</span>
        <Chevron open={expanded} />
      </button> : <span className="text-sm font-black text-[var(--ac-muted)]">{models.length}</span>}
    </div>

    <label className="mt-5 flex h-12 w-full items-center gap-3 rounded-2xl bg-[var(--ac-surface-2)] px-4 text-[var(--ac-muted)] focus-within:ring-2 focus-within:ring-red-500/35">
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
