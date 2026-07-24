"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type CitySuggestion = { city: string; region?: string; value?: string };

type Props = {
  value: string;
  onChange: (city: string) => void;
};

const STORAGE_KEY = "avtocena_city";
const POPULAR_CITIES = ["Москва", "Санкт-Петербург", "Новосибирск", "Екатеринбург", "Казань", "Красноярск", "Омск", "Самара", "Челябинск", "Ростов-на-Дону", "Уфа", "Новокузнецк", "Барнаул", "Иркутск", "Владивосток"];

function LocationIcon({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s7-5.6 7-12A7 7 0 1 0 5 9c0 6.4 7 12 7 12Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="12" cy="9" r="2.6" stroke="currentColor" strokeWidth="2" /></svg>;
}

function persistCity(city: string) {
  try { localStorage.setItem(STORAGE_KEY, city); } catch {}
  document.cookie = `avtocena_city=${encodeURIComponent(city)}; Max-Age=15552000; Path=/; SameSite=Lax`;
  const url = new URL(window.location.href);
  url.searchParams.set("city", city);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function CitySelector({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    let stored = "";
    try { stored = localStorage.getItem(STORAGE_KEY) || ""; } catch {}
    if (stored && stored !== value) onChange(stored);
    if (stored || value) return;
    let cancelled = false;
    fetch("/api/location/city", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        const city = String(data?.city || "").trim();
        if (!cancelled && city) {
          onChange(city);
          persistCity(city);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", escape);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const normalized = query.trim();
    if (normalized.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetch(`/api/location/city?q=${encodeURIComponent(normalized)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const filteredPopular = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return POPULAR_CITIES.filter((city) => !normalized || city.toLocaleLowerCase("ru-RU").includes(normalized)).slice(0, 10);
  }, [query]);

  const choose = (city: string) => {
    const normalized = city.trim().replace(/^г\.?\s*/i, "");
    if (!normalized) return;
    onChange(normalized);
    persistCity(normalized);
    setOpen(false);
    setQuery("");
    setSuggestions([]);
  };

  const label = value || "Ваш город";

  return <>
    <span className="ac-city-selector mt-2 flex w-fit max-w-full items-center text-[.74em] leading-none lg:mt-0 lg:inline-flex">
      <button
        type="button"
        onClick={() => { setQuery(value || ""); setOpen(true); }}
        className="inline-flex min-w-0 max-w-full items-center gap-[.13em] border-b-[.045em] border-dotted border-current px-[.08em] py-[.04em] text-left font-black text-[var(--ac-muted)] transition hover:text-[var(--ac-text)]"
        aria-label={`Выбрать город. Сейчас: ${label}`}
      >
        <LocationIcon className="h-[.78em] w-[.78em] shrink-0" /><span className="truncate">{label}</span>
      </button>
    </span>

    {mounted && open ? createPortal(<div className="fixed inset-0 z-[15000] flex items-end justify-center bg-black/65 p-0 backdrop-blur-md md:items-center md:p-6" onClick={() => setOpen(false)}>
      <section className="w-full max-w-[560px] rounded-t-[28px] bg-[var(--ac-surface)] p-5 text-[var(--ac-text)] shadow-[0_-24px_80px_rgba(0,0,0,.42)] md:rounded-[28px] md:p-6" role="dialog" aria-modal="true" aria-label="Выбор города" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[var(--ac-muted)]/35 md:hidden" />
        <div className="flex items-start justify-between gap-4"><div><div className="text-xs font-black uppercase tracking-[.16em] text-red-500">Город доставки</div><h2 className="mt-1 text-2xl font-black">Куда привезти автомобиль?</h2><p className="mt-2 text-sm font-medium leading-6 text-[var(--ac-muted)]">Город сохранится на этом устройстве и будет подставляться в подбор.</p></div><button type="button" onClick={() => setOpen(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ac-surface-2)] text-2xl" aria-label="Закрыть">×</button></div>
        <div className="relative mt-5"><LocationIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--ac-muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") choose(suggestions[0]?.city || query); }} autoFocus placeholder="Начните вводить город" className="h-14 w-full rounded-2xl bg-[var(--ac-surface-2)] pl-12 pr-4 text-base font-bold text-[var(--ac-text)] outline-none placeholder:text-[var(--ac-muted)]" /></div>
        <div className="ac-hide-scrollbar mt-3 max-h-[45vh] overflow-y-auto">
          {loading ? <div className="px-3 py-4 text-sm font-bold text-[var(--ac-muted)]">Ищем город…</div> : null}
          {suggestions.map((item) => <button key={`${item.city}-${item.region || ""}`} type="button" onClick={() => choose(item.city)} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-[var(--ac-surface-2)]"><span className="font-black">{item.city}</span><span className="truncate text-xs font-bold text-[var(--ac-muted)]">{item.region}</span></button>)}
          {!suggestions.length && !loading ? <div className="grid grid-cols-2 gap-2 pt-1">{filteredPopular.map((city) => <button key={city} type="button" onClick={() => choose(city)} className="rounded-xl bg-[var(--ac-surface-2)] px-3 py-3 text-left text-sm font-black">{city}</button>)}</div> : null}
        </div>
        <button type="button" onClick={() => choose(query)} disabled={!query.trim()} className="avto-button mt-4 flex h-14 w-full items-center justify-center rounded-2xl text-base font-black disabled:cursor-not-allowed disabled:opacity-45">Выбрать город</button>
      </section>
    </div>, document.body) : null}
  </>;
}
