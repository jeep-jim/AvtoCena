"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BrandLogoVisual } from "@/components/catalog/BrandLogoRail";

type Option = { value: string; label: string };
type BrandStats = {
  generationId?: string;
  counts: Record<string, number>;
  modelCounts: Record<string, number>;
};

const EMPTY_STATS: BrandStats = { counts: {}, modelCounts: {} };
const REQUEST_CACHE_MS = 30_000;
const REQUESTS = new Map<string, { at: number; promise: Promise<BrandStats> }>();

function clean(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitMakes(value: string) {
  return [...new Set(String(value || "").split(",").map(clean).filter(Boolean))];
}

function joinMakes(values: string[]) {
  return [...new Set(values.map(clean).filter(Boolean))].join(",");
}

function loadBrandStats(query: string) {
  const key = query || "__all__";
  const now = Date.now();
  const cached = REQUESTS.get(key);
  if (cached && now - cached.at < REQUEST_CACHE_MS) return cached.promise;
  const suffix = query ? `?${query}` : "";
  const promise = fetch(`/api/catalog/brand-counts${suffix}`, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`catalog_brand_stats_http_${response.status}`);
      const payload = await response.json();
      return {
        generationId: String(payload?.generationId || ""),
        counts: payload?.counts && typeof payload.counts === "object" ? payload.counts : {},
        modelCounts: payload?.modelCounts && typeof payload.modelCounts === "object" ? payload.modelCounts : {},
      } as BrandStats;
    })
    .catch((error) => {
      REQUESTS.delete(key);
      throw error;
    });
  REQUESTS.set(key, { at: now, promise });
  return promise;
}

function modelCountLabel(value: number) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  const mod100 = n % 100;
  const mod10 = n % 10;
  const word = mod100 >= 11 && mod100 <= 14 ? "моделей" : mod10 === 1 ? "модель" : mod10 >= 2 && mod10 <= 4 ? "модели" : "моделей";
  return `${n} ${word}`;
}

function Chevron({ open }: { open: boolean }) {
  return <svg className={`shrink-0 transition ${open ? "rotate-180" : ""}`} width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function CatalogBrandMultiSelect({
  value,
  options,
  contextQuery,
  onChange,
  className = "",
}: {
  value: string;
  options: Option[];
  contextQuery: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [stats, setStats] = useState<BrandStats>(EMPTY_STATS);
  const root = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => splitMakes(value), [value]);
  const selectedKeys = useMemo(() => new Set(selected.map((make) => make.toLocaleLowerCase("ru-RU"))), [selected]);

  useEffect(() => {
    let cancelled = false;
    loadBrandStats(contextQuery)
      .then((next) => { if (!cancelled) setStats(next); })
      .catch(() => { if (!cancelled) setStats(EMPTY_STATS); });
    return () => { cancelled = true; };
  }, [contextQuery]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const brands = useMemo(() => options
    .filter((option) => Boolean(option.value))
    .filter((option) => {
      const needle = query.trim().toLocaleLowerCase("ru-RU");
      return !needle || option.label.toLocaleLowerCase("ru-RU").includes(needle);
    }), [options, query]);

  const toggle = (make: string) => {
    const key = make.toLocaleLowerCase("ru-RU");
    const next = selectedKeys.has(key)
      ? selected.filter((item) => item.toLocaleLowerCase("ru-RU") !== key)
      : [...selected, make];
    onChange(joinMakes(next));
  };

  const triggerLabel = selected.length === 0
    ? "Любая марка"
    : selected.length === 1
      ? selected[0]
      : `Выбрано марок: ${selected.length}`;

  return <div ref={root} className={`relative min-w-0 ${open ? "z-[245]" : "z-0"} ${className}`}>
    <input type="hidden" name="make" value={value} />
    <button type="button" onClick={() => setOpen((current) => !current)} className="ac-filter-control flex h-13 w-full items-center justify-between gap-2 rounded-[15px] px-4 text-left text-sm font-black" aria-expanded={open} aria-label="Выбрать марки автомобилей">
      <span className="truncate">{triggerLabel}</span><Chevron open={open} />
    </button>
    {open ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти марку" className="ac-filter-search h-10 min-w-0 flex-1 rounded-xl px-3 text-sm font-bold outline-none" />
        {selected.length ? <button type="button" onClick={() => onChange("")} className="h-10 shrink-0 rounded-xl border border-red-500/35 px-3 text-[11px] font-black text-red-500">Очистить</button> : null}
      </div>
      <div className="ac-hide-scrollbar max-h-72 overflow-y-auto">
        {brands.map((option) => {
          const active = selectedKeys.has(option.value.toLocaleLowerCase("ru-RU"));
          const modelCount = Number(stats.modelCounts[option.value] || 0);
          return <button key={option.value} type="button" data-facet-value={option.value} onClick={() => toggle(option.value)} className={`ac-filter-option flex min-h-12 w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left ${active ? "is-active" : ""}`} aria-pressed={active}>
            <BrandLogoVisual brand={option.value} className="h-8 w-12 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-black">{option.label}<span className="ml-1.5 text-[11px] font-bold text-[var(--ac-muted)]">· {modelCount ? modelCountLabel(modelCount) : "…"}</span></span>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-black transition ${active ? "bg-red-500 text-white" : "border border-[var(--ac-border)] text-transparent"}`}>✓</span>
          </button>;
        })}
        {!brands.length ? <div className="px-3 py-5 text-center text-sm font-bold text-[var(--ac-muted)]">Марка не найдена</div> : null}
      </div>
    </div> : null}
  </div>;
}
