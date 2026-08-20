"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BrandLogoVisual } from "@/components/catalog/BrandLogoRail";

type BrandModelLink = {
  id: string;
  model: string;
  slug: string;
  count: number;
  aliases?: string[];
  bodyTypes?: string[];
  yearFrom?: number;
  yearTo?: number;
  previewUrl?: string;
};

const PREVIEW_LIMIT = 8;

function searchable(value: unknown) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function yearLabel(from?: number, to?: number) {
  if (from && to) return from === to ? String(from) : `${from}–${to}`;
  if (from) return `с ${from}`;
  if (to) return `до ${to}`;
  return "";
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
      <div>
        <h2 className="text-2xl font-black md:text-4xl">Модели {brand}</h2>
        <p className="mt-1 text-xs font-bold text-[var(--ac-muted)]">Выберите модель и посмотрите доступные автомобили со всех рынков.</p>
      </div>
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

    {filtered.length ? <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {filtered.map((model) => {
        return <article
          key={model.id}
          className="overflow-hidden rounded-2xl bg-[var(--ac-surface-2)] transition"
        >
          <Link
            href={`/cars/brand/${brandSlug}/model/${model.slug}`}
            className="group block w-full text-left transition hover:bg-[var(--ac-surface-3)]"
          >
            <span className="relative flex h-24 items-center justify-center overflow-hidden bg-[var(--ac-surface)] sm:h-28">
              {model.previewUrl ? <img src={model.previewUrl} alt={`${brand} ${model.model}`} loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]" /> : <BrandLogoVisual brand={brand} className="!h-12 !w-24 opacity-55" />}
              {model.count > 0 ? <span className="absolute right-2 top-2 rounded-full bg-black/65 px-2 py-1 text-[9px] font-black text-white">{model.count} в продаже</span> : null}
            </span>
            <span className="flex min-h-14 items-center justify-between gap-2 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm font-black text-[var(--ac-text)] transition group-hover:text-red-500">{model.model}</span>
                <span className="mt-0.5 block truncate text-[10px] font-bold text-[var(--ac-muted)]">{yearLabel(model.yearFrom, model.yearTo) || (model.count ? `${model.count} предложений` : "Под заказ")}</span>
              </span>
              <span className="shrink-0 text-lg font-black text-[var(--ac-muted)]">→</span>
            </span>
          </Link>
        </article>;
      })}
    </div> : normalizedQuery ? <p className="mt-5 text-sm font-bold text-[var(--ac-muted)]">Такой модели в списке нет.</p> : null}
  </section>;
}
