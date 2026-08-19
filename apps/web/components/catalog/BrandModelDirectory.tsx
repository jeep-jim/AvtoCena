"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type NumericRange = { min: number; max: number; count: number };
type BrandModelLink = {
  id: string;
  model: string;
  slug: string;
  count: number;
  aliases?: string[];
  bodyTypes?: string[];
  yearFrom?: number;
  yearTo?: number;
  representativePowerHp?: number;
  knowledge?: {
    records: number;
    variants: number;
    trustedVariants: number;
    observations: number;
    references: number;
    powerHp?: NumericRange;
    powerKw?: NumericRange;
    power30MinKw?: NumericRange;
    utilizationPowerKw?: NumericRange;
    engineCc?: NumericRange;
    fuels: string[];
    powertrains: string[];
  };
};

type KnowledgeRow = { label: string; value: string };

const PREVIEW_LIMIT = 6;

function searchable(value: unknown) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function compactNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".0", "");
}

function rangeLabel(range?: NumericRange, unit = "") {
  if (!range) return "";
  const value = range.min === range.max ? compactNumber(range.min) : `${compactNumber(range.min)}–${compactNumber(range.max)}`;
  return `${value}${unit ? ` ${unit}` : ""}`;
}

function yearLabel(from?: number, to?: number) {
  if (from && to) return from === to ? String(from) : `${from}–${to}`;
  if (from) return `с ${from}`;
  if (to) return `до ${to}`;
  return "";
}

function modelKnowledgeLabel(model: BrandModelLink) {
  const hp = rangeLabel(model.knowledge?.powerHp, "л.с.");
  const kw30 = rangeLabel(model.knowledge?.power30MinKw, "кВт 30 мин");
  if (hp && kw30) return `${hp} · ${kw30}`;
  if (hp) return hp;
  if (kw30) return kw30;
  if (model.representativePowerHp) return `${compactNumber(model.representativePowerHp)} л.с.`;
  if (model.knowledge?.trustedVariants) return `${model.knowledge.trustedVariants} провер. модификаций`;
  return model.knowledge?.records ? `${model.knowledge.records} записей источников` : "";
}

function modelKnowledgeRows(model: BrandModelLink): KnowledgeRow[] {
  const rows = [
    yearLabel(model.yearFrom, model.yearTo) ? { label: "Годы выпуска", value: yearLabel(model.yearFrom, model.yearTo) } : null,
    rangeLabel(model.knowledge?.engineCc, "см³") ? { label: "Объём двигателя", value: rangeLabel(model.knowledge?.engineCc, "см³") } : null,
    rangeLabel(model.knowledge?.powerHp, "л.с.") ? { label: "Мощность", value: rangeLabel(model.knowledge?.powerHp, "л.с.") } : null,
    rangeLabel(model.knowledge?.powerKw, "кВт") ? { label: "Мощность", value: rangeLabel(model.knowledge?.powerKw, "кВт") } : null,
    rangeLabel(model.knowledge?.power30MinKw, "кВт") ? { label: "30-минутная", value: rangeLabel(model.knowledge?.power30MinKw, "кВт") } : null,
    rangeLabel(model.knowledge?.utilizationPowerKw, "кВт") ? { label: "Для утильсбора", value: rangeLabel(model.knowledge?.utilizationPowerKw, "кВт") } : null,
    model.knowledge?.trustedVariants ? { label: "Проверенных", value: String(model.knowledge.trustedVariants) } : null,
    model.knowledge?.observations ? { label: "Наблюдений", value: String(model.knowledge.observations) } : null,
    model.count ? { label: "Предложений", value: String(model.count) } : null,
  ];
  return rows.filter((row): row is KnowledgeRow => Boolean(row));
}

function modelTags(model: BrandModelLink) {
  return [...new Set([
    ...(model.knowledge?.fuels || []),
    ...(model.knowledge?.powertrains || []),
    ...(model.bodyTypes || []),
  ].map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 10);
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
  const [openModelId, setOpenModelId] = useState<string | null>(null);
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
        <p className="mt-1 text-xs font-bold text-[var(--ac-muted)]">Нажмите на модель, чтобы раскрыть собранные сведения. Наблюдения источников видны в энциклопедии, но в расчёт попадают только подтверждённые характеристики.</p>
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

    {filtered.length ? <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {filtered.map((model) => {
        const knowledge = modelKnowledgeLabel(model);
        const open = openModelId === model.id;
        const detailId = `model-knowledge-${searchable(model.id)}`;
        const rows = modelKnowledgeRows(model);
        const tags = modelTags(model);
        return <article
          key={model.id}
          className={`overflow-hidden rounded-2xl bg-[var(--ac-surface-2)] transition ${open ? "col-span-2 sm:col-span-3 lg:col-span-6 ring-1 ring-red-500/20" : ""}`}
        >
          <button
            type="button"
            onClick={() => setOpenModelId(open ? null : model.id)}
            className="group flex min-h-14 w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition hover:bg-[var(--ac-surface-3)] hover:text-red-500"
            aria-expanded={open}
            aria-controls={detailId}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-black">{model.model}</span>
              {knowledge ? <span className="mt-0.5 block truncate text-[10px] font-bold text-[var(--ac-muted)]">{knowledge}</span> : <span className="mt-0.5 block truncate text-[10px] font-bold text-[var(--ac-muted)]">Данные ещё не собраны</span>}
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[10px] font-black text-[var(--ac-muted)]">
              {model.count > 0 ? <span>{model.count}</span> : null}
              <Chevron open={open} />
            </span>
          </button>

          {open ? <div id={detailId} className="border-t border-black/5 px-3 pb-3 pt-3 dark:border-white/5 md:px-4 md:pb-4">
            {rows.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              {rows.map((row) => <div key={`${row.label}-${row.value}`} className="rounded-xl bg-[var(--ac-surface)] px-3 py-2.5">
                <div className="text-[9px] font-black uppercase tracking-[0.12em] text-[var(--ac-muted)]">{row.label}</div>
                <div className="mt-1 text-sm font-black text-[var(--ac-text)]">{row.value}</div>
              </div>)}
            </div> : <p className="rounded-xl bg-[var(--ac-surface)] px-3 py-3 text-xs font-bold leading-5 text-[var(--ac-muted)]">Для этой модели пока нет source-backed данных. Непроверенные цифры в расчёт не подставляются.</p>}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {tags.map((tag) => <span key={tag} className="rounded-full bg-[var(--ac-surface)] px-3 py-1.5 text-[10px] font-black text-[var(--ac-muted)]">{tag}</span>)}
              <Link
                href={`/cars/brand/${brandSlug}/model/${model.slug}`}
                className="ml-auto inline-flex min-h-10 items-center rounded-xl bg-red-500 px-4 text-xs font-black text-white transition hover:bg-red-600"
              >
                Все сведения и предложения →
              </Link>
            </div>
          </div> : null}
        </article>;
      })}
    </div> : normalizedQuery ? <p className="mt-5 text-sm font-bold text-[var(--ac-muted)]">Такой модели в списке нет.</p> : null}
  </section>;
}
