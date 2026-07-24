"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandLogoRail } from "@/components/catalog/BrandLogoRail";
import { BuyerGallery } from "@/components/home/BuyerGallery";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { CurrencyRatesStrip } from "@/components/catalog/CurrencyRatesStrip";
import { CurrencyFlag, type PublicCurrencyRate } from "@/components/catalog/PriceTrend";
import { CitySelector } from "@/components/home/CitySelector";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { appendAttributionToSearchParams } from "@/lib/attribution";
import { canonicalCatalogBrand } from "@/lib/catalog/brands";
import { isCrediblePublicOffer } from "@/lib/catalog/offer-quality";
import { presentCatalogOffer } from "@/lib/catalog/presentation";

type Option = { value: string; label: string; min?: number; max?: number };
type Item = { raw: any; id: string; make: string; model: string; market: string; bodyType?: string; fuel?: string };
type Props = { initialCity?: string };

const budgets: Option[] = [
  { value: "", label: "Любой бюджет" },
  { value: "1500000", label: "до 1 500 000 ₽", max: 1_500_000 },
  { value: "2000000", label: "до 2 000 000 ₽", max: 2_000_000 },
  { value: "2500000", label: "до 2 500 000 ₽", max: 2_500_000 },
  { value: "3000000", label: "до 3 000 000 ₽", max: 3_000_000 },
  { value: "4000000", label: "до 4 000 000 ₽", max: 4_000_000 },
  { value: "5000000", label: "до 5 000 000 ₽", max: 5_000_000 },
  { value: "6000000", label: "до 6 000 000 ₽", max: 6_000_000 },
  { value: "from6000000", label: "от 6 000 000 ₽", min: 6_000_000 },
];

const markets: Option[] = [
  { value: "", label: "Страна" },
  { value: "japan", label: "Япония" },
  { value: "china", label: "Китай" },
  { value: "korea", label: "Корея" },
  { value: "uae", label: "ОАЭ" },
  { value: "europe", label: "Европа" },
];

const years: Option[] = [
  { value: "", label: "Год" },
  ...[2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018].map((year) => ({ value: String(year), label: String(year) })),
  { value: "older", label: "Старше 2018" },
];

const bodies: Option[] = [
  { value: "", label: "Кузов" },
  { value: "suv", label: "Кроссовер" },
  { value: "offroad", label: "Внедорожник" },
  { value: "sedan", label: "Седан" },
  { value: "wagon", label: "Универсал" },
  { value: "hatchback", label: "Хэтчбек" },
  { value: "minivan", label: "Минивэн" },
  { value: "pickup", label: "Пикап" },
];

const marketIds = ["korea", "china", "japan", "uae", "europe"];
const marketMeta: Record<string, { label: string; currency: string }> = {
  korea: { label: "Корея", currency: "KRW" },
  china: { label: "Китай", currency: "CNY" },
  japan: { label: "Япония", currency: "JPY" },
  uae: { label: "ОАЭ", currency: "AED" },
  europe: { label: "Европа", currency: "EUR" },
};

const buyers = Array.from({ length: 15 }, (_, index) => `/buyers/${index + 1}.jpg`);
const benefits = [
  { icon: "fast", title: "Без регистрации", text: "Сразу получите первую выдачу по вашему бюджету." },
  { icon: "markets", title: "5 рынков", text: "Япония, Китай, Корея, ОАЭ и Европа в одном подборе." },
  { icon: "delivery", title: "Под ключ", text: "Доставка, таможня и оформление входят в структуру расчёта." },
];

function cleanFuel(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase("ru-RU");
}

function isElectricOffer(value: { fuel?: string; raw?: any }) {
  const fuel = cleanFuel(value.fuel || value.raw?.fuel || value.raw?.engineType);
  return fuel === "electric" || fuel === "электро" || fuel === "электромобиль" || fuel === "bev";
}

function toItem(raw: any): Item | null {
  if (!isCrediblePublicOffer(raw as any)) return null;
  const offer = presentCatalogOffer(raw);
  return {
    raw,
    id: offer.id,
    make: canonicalCatalogBrand(String(raw.make || "")),
    model: String(raw.model || ""),
    market: offer.market,
    bodyType: String(raw.bodyType || "") || undefined,
    fuel: String(raw.fuel || "") || undefined,
  };
}

async function loadFuelOffers(fuel: string) {
  const loadMarket = async (market: string) => {
    const first = await fetch(`/api/catalog/search?market=${market}&fuel=${encodeURIComponent(fuel)}&pageSize=48&page=1&sort=updatedAt`, { cache: "no-store" }).then((response) => response.json());
    const total = Math.max(0, Number(first?.total || 0));
    const pageCount = Math.max(1, Math.ceil(total / 48));
    const rest = pageCount > 1
      ? await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => fetch(`/api/catalog/search?market=${market}&fuel=${encodeURIComponent(fuel)}&pageSize=48&page=${index + 2}&sort=updatedAt`, { cache: "no-store" }).then((response) => response.json())))
      : [];
    return [first, ...rest].flatMap((response) => Array.isArray(response?.items) ? response.items : []);
  };
  return (await Promise.all(marketIds.map(loadMarket))).flat();
}

function Chevron({ open = false }: { open?: boolean }) {
  return <svg className={`shrink-0 transition ${open ? "rotate-180" : ""}`} width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function SlidersIcon() {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7H20M4 17H20M8 4V10M16 14V20" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /><circle cx="8" cy="7" r="2" fill="currentColor" /><circle cx="16" cy="17" r="2" fill="currentColor" /></svg>;
}

function BenefitIcon({ type }: { type: string }) {
  if (type === "fast") return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.5 2L5 13H11L10.5 22L19 10.5H13L13.5 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (type === "markets") return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" /><path d="M3.8 12H20.2M12 3.5C14.2 5.8 15.4 8.6 15.4 12C15.4 15.4 14.2 18.2 12 20.5C9.8 18.2 8.6 15.4 8.6 12C8.6 8.6 9.8 5.8 12 3.5Z" stroke="currentColor" strokeWidth="1.7" /></svg>;
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7H15V17H3V7ZM15 10H19L22 13V17H15V10Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="7" cy="18" r="2" stroke="currentColor" strokeWidth="2" /><circle cx="18" cy="18" r="2" stroke="currentColor" strokeWidth="2" /></svg>;
}

function HomeSelect({ value, options, onChange, searchable = false, searchPlaceholder = "Поиск" }: { value: string; options: Option[]; onChange: (value: string) => void; searchable?: boolean; searchPlaceholder?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const active = options.find((option) => option.value === value) || options[0];
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return normalized ? options.filter((option) => option.label.toLocaleLowerCase("ru-RU").includes(normalized)) : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery("");
  };

  return <div ref={root} className={`relative min-w-0 ${open ? "z-[230]" : "z-0"}`}>
    <button type="button" onClick={() => setOpen((current) => !current)} className="ac-filter-control flex h-14 w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-sm font-black" aria-expanded={open}><span className="min-w-0 truncate">{active?.label}</span><Chevron open={open} /></button>
    {open ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2">
      {searchable ? <div className="mb-1.5"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} autoFocus={false} className="ac-filter-search h-10 w-full rounded-xl px-3 text-sm font-bold outline-none" /></div> : null}
      <div className="ac-hide-scrollbar max-h-64 overflow-y-auto">{filtered.length ? filtered.map((option) => <button key={option.value || "any"} type="button" onClick={() => choose(option.value)} className={`ac-filter-option flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${value === option.value ? "is-active" : ""}`}><span className="truncate">{option.label}</span>{value === option.value ? <span>✓</span> : null}</button>) : <div className="px-3 py-5 text-center text-sm font-bold text-white/40">Ничего не найдено</div>}</div>
    </div> : null}
  </div>;
}

function ElectricFilter({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="ac-filter-control ac-electric-filter flex h-14 cursor-pointer items-center gap-2 rounded-2xl px-3 text-sm font-black">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sm transition" style={{ background: checked ? "#ffd21f" : "var(--ac-surface-3)", border: checked ? "1px solid #ffd21f" : "1px solid rgba(103,113,130,.55)", color: checked ? "#171a21" : "transparent" }}>✓</span>
    <span className="text-[17px] leading-none text-[#ffd21f]" aria-hidden="true">⚡</span>
    <span className="truncate">Электро</span>
  </label>;
}

function PowerLimit({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!infoOpen) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setInfoOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [infoOpen]);

  return <div ref={root} className={`relative ${infoOpen ? "z-[250]" : "z-0"}`}>
    <label className="ac-filter-control ac-power-limit flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl px-4 pr-14 text-sm font-black">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-sm transition" style={{ background: checked ? "#ff353d" : "var(--ac-surface-3)", border: checked ? "1px solid #ff353d" : "1px solid rgba(103,113,130,.55)", color: checked ? "#ffffff" : "transparent" }}>✓</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"><span>До 160 л.с.</span><span className="text-[11px] font-black text-red-500">свыше — полная пошлина</span></span>
    </label>
    <button type="button" onClick={() => setInfoOpen((current) => !current)} className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-sm font-black" style={{ background: "var(--ac-surface-3)", border: "1px solid rgba(103,113,130,.45)" }} aria-label="Почему есть фильтр до 160 лошадиных сил" aria-expanded={infoOpen}>?</button>
    {infoOpen ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+8px)] rounded-2xl p-4 text-sm font-bold leading-6"><div className="font-black">Почему до 160 л.с.?</div><p className="mt-2 text-[var(--ac-muted)]">Для автомобилей мощностью свыше 160 л.с. льготный расчёт утилизационного сбора при личном ввозе не применяется. Используется полная ставка, поэтому итоговые платежи могут быть значительно выше.</p><p className="mt-2 font-black text-red-500">Свыше 160 л.с. — полная пошлина.</p></div> : null}
  </div>;
}

function BudgetLabel({ onInfo }: { onInfo: () => void }) {
  return <span className="inline-flex shrink-0 items-center gap-1 text-xs font-black uppercase tracking-[0.16em] text-red-400"><span>Бюджет</span><button type="button" onClick={onInfo} className="ac-budget-help flex h-5 w-5 items-center justify-center rounded-full bg-red-500/12 text-[11px] font-black normal-case tracking-normal" aria-label="Как работает подбор по бюджету">?</button></span>;
}

export default function HomePageClient({ initialCity = "" }: Props) {
  const router = useRouter();
  const [city, setCity] = useState(initialCity);
  const [budget, setBudget] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [market, setMarket] = useState("");
  const [body, setBody] = useState("");
  const [powerLimited, setPowerLimited] = useState(false);
  const [electricOnly, setElectricOnly] = useState(false);
  const [fuelItems, setFuelItems] = useState<Item[] | null>(null);
  const [catalogMarket, setCatalogMarket] = useState("");
  const [catalogMake, setCatalogMake] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [rates, setRates] = useState<PublicCurrencyRate[]>([]);
  const [marketCounts, setMarketCounts] = useState<Record<string, number>>({});
  const [count, setCount] = useState<number | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [budgetInfoOpen, setBudgetInfoOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadCatalog = async () => {
      const stamp = Date.now();
      try {
        const responses = await Promise.all([
          fetch(`/api/catalog/search?pageSize=48&sort=updatedAt&includeRates=1&_=${stamp}`, { cache: "no-store", headers: { "cache-control": "no-cache" } }).then((response) => response.json()),
          ...marketIds.map((id) => fetch(`/api/catalog/search?market=${id}&pageSize=48&sort=updatedAt&_=${stamp}`, { cache: "no-store", headers: { "cache-control": "no-cache" } }).then((response) => response.json())),
        ]);
        if (cancelled) return;
        const unique = new Map<string, Item>();
        for (const raw of responses.flatMap((response) => Array.isArray(response?.items) ? response.items : [])) {
          const item = toItem(raw);
          if (item) unique.set(item.id, item);
        }
        setItems([...unique.values()]);
        setRates(Array.isArray(responses[0]?.rates) ? responses[0].rates : []);
        setMarketCounts(Object.fromEntries(marketIds.map((id, index) => [id, Number(responses[index + 1]?.total || 0)])));
      } catch {
        if (!cancelled) setItems([]);
      }
    };
    loadCatalog();
    const interval = window.setInterval(loadCatalog, 60_000);
    const focus = () => loadCatalog();
    const visibility = () => { if (document.visibilityState === "visible") loadCatalog(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    if (!electricOnly) {
      setFuelItems(null);
      return;
    }
    let cancelled = false;
    loadFuelOffers("electric").then((rawItems) => {
      if (cancelled) return;
      const unique = new Map<string, Item>();
      rawItems.forEach((raw) => {
        const item = toItem(raw);
        if (item) unique.set(item.id, item);
      });
      setFuelItems([...unique.values()]);
    }).catch(() => {
      if (!cancelled) setFuelItems([]);
    });
    return () => { cancelled = true; };
  }, [electricOnly]);

  useEffect(() => {
    if (!mobileFiltersOpen) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileFiltersOpen(false); };
    window.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = old;
      window.removeEventListener("keydown", keydown);
    };
  }, [mobileFiltersOpen]);

  useEffect(() => { if (model && body) setBody(""); }, [model, body]);

  const availableItems = useMemo(() => {
    if (!electricOnly) return items;
    return fuelItems || items.filter(isElectricOffer);
  }, [electricOnly, fuelItems, items]);

  const makeOptions = useMemo<Option[]>(() => {
    const values = new Map<string, string>();
    availableItems.forEach((item) => values.set(item.make.toLocaleLowerCase("en-US"), item.make));
    return [{ value: "", label: "Марка" }, ...[...values.values()].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru")).map((label) => ({ value: label, label }))];
  }, [availableItems]);

  const modelOptions = useMemo<Option[]>(() => {
    const values = new Map<string, string>();
    availableItems.filter((item) => !make || item.make === make).forEach((item) => values.set(item.model, presentCatalogOffer(item.raw).modelLabel));
    return [{ value: "", label: "Модель" }, ...[...values].filter(([value]) => value).sort((a, b) => a[1].localeCompare(b[1], "ru")).map(([value, label]) => ({ value, label }))];
  }, [availableItems, make]);

  const bodyOptions = useMemo<Option[]>(() => {
    const available = new Set(availableItems.map((item) => item.bodyType).filter(Boolean));
    return [bodies[0], ...bodies.slice(1).filter((option) => available.has(option.value))];
  }, [availableItems]);

  const marketOptions = useMemo<Option[]>(() => {
    if (!electricOnly) return markets;
    const available = new Set(availableItems.map((item) => item.market));
    return [markets[0], ...markets.slice(1).filter((option) => available.has(option.value))];
  }, [availableItems, electricOnly]);

  useEffect(() => {
    if (make && !makeOptions.some((option) => option.value === make)) {
      setMake("");
      setModel("");
    }
    if (market && !marketOptions.some((option) => option.value === market)) setMarket("");
    if (body && !bodyOptions.some((option) => option.value === body)) setBody("");
  }, [body, bodyOptions, make, makeOptions, market, marketOptions]);

  const selectedBudget = budgets.find((option) => option.value === budget) || budgets[0];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ pageSize: "1" });
      if (selectedBudget.min) params.set("budgetFrom", String(selectedBudget.min));
      if (selectedBudget.max) params.set("budgetTo", String(selectedBudget.max));
      if (make) params.set("make", make);
      if (model) params.set("model", model);
      if (market) params.set("market", market);
      if (body && !model) params.set("bodyType", body);
      if (year === "older") params.set("yearTo", "2017"); else if (year) params.set("yearFrom", year);
      if (powerLimited) params.set("powerTo", "160");
      if (electricOnly) params.set("fuel", "electric");
      setCount(null);
      fetch(`/api/catalog/search?${params}`, { cache: "no-store" }).then((response) => response.json()).then((data) => setCount(Number(data?.total || 0))).catch(() => setCount(0));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [selectedBudget.min, selectedBudget.max, make, model, market, body, year, powerLimited, electricOnly]);

  const marketGroups = useMemo(() => marketIds
    .filter((id) => !catalogMarket || id === catalogMarket)
    .map((id) => {
      const matches = availableItems.filter((item) => item.market === id && (!catalogMake || item.make === catalogMake));
      return { id, total: matches.length, items: matches.slice(0, 6) };
    })
    .filter((group) => group.items.length), [availableItems, catalogMarket, catalogMake]);

  const setElectric = (checked: boolean) => {
    setElectricOnly(checked);
    setFuelItems(null);
    setMake("");
    setModel("");
    setBody("");
    setMarket("");
    setCatalogMake("");
    setCatalogMarket("");
  };

  const submit = () => {
    const params = new URLSearchParams();
    if (selectedBudget.min) params.set("budgetFrom", String(selectedBudget.min));
    if (selectedBudget.max) params.set("budget", String(selectedBudget.max));
    if (make) params.set("brand", make);
    if (model) params.set("model", model);
    if (market) params.set("market", market);
    if (body && !model) params.set("body", body);
    if (year === "older") params.set("yearTo", "2017"); else if (year) params.set("yearFrom", year);
    if (powerLimited) params.set("powerTo", "160");
    if (electricOnly) params.set("fuel", "electric");
    if (city) params.set("city", city);
    appendAttributionToSearchParams(params);
    router.push(`/results${params.toString() ? `?${params}` : ""}`);
  };

  const catalogQuery = new URLSearchParams();
  if (catalogMarket) catalogQuery.set("market", catalogMarket);
  if (catalogMake) catalogQuery.set("make", catalogMake);
  if (electricOnly) catalogQuery.set("fuel", "electric");
  const catalogHref = `/cars${catalogQuery.toString() ? `?${catalogQuery}` : ""}`;

  return <main className="ac-home-page ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader />
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-16 md:px-8">
      <section className="ac-home-hero grid items-start gap-7 pb-3 pt-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-10 lg:py-12">
        <div><h1 className="max-w-5xl text-[42px] font-black leading-[.93] tracking-[-0.055em] sm:text-[64px] lg:text-[78px] xl:text-[90px]"><span>Цена на авто под заказ</span> <CitySelector value={city} onChange={setCity} /></h1><p className="mt-5 hidden text-lg font-medium text-white/75 lg:block lg:text-xl">Укажите бюджет — покажем, что можно привезти под ключ.</p><div className="mt-7 hidden grid-cols-1 gap-4 lg:grid">{benefits.map((item) => <div key={item.title} className="flex items-center gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400"><BenefitIcon type={item.icon} /></div><div><div className="font-black">{item.title}</div><div className="mt-1 text-sm text-white/45">{item.text}</div></div></div>)}</div></div>
        <div id="form" className="ac-filter-panel rounded-[1.8rem] bg-white/[0.075] p-4 md:p-5">
          <div className="mb-4 flex items-center justify-between gap-3"><BudgetLabel onInfo={() => setBudgetInfoOpen(true)} /><span className="flex items-center gap-2 text-[11px] font-black text-white/65"><span className="ac-pulse-dot ac-pulse-dot--status" aria-hidden="true"><span /></span>{count === null ? "Считаем варианты" : `Нашли ${count} вариантов`}</span></div>
          <div className="grid grid-cols-2 gap-3"><HomeSelect value={budget} options={budgets} onChange={setBudget} /><ElectricFilter checked={electricOnly} onChange={setElectric} /></div>
          <div className="mt-4 grid grid-cols-2 gap-3"><HomeSelect value={make} options={makeOptions} onChange={(value) => { setMake(value); setModel(""); }} searchable searchPlaceholder="Найти марку" /><HomeSelect value={model} options={modelOptions} onChange={setModel} searchable searchPlaceholder="Найти модель" /></div>
          <div className="mt-4"><PowerLimit checked={powerLimited} onChange={setPowerLimited} /></div>
          <div className="mt-4 hidden grid-cols-2 gap-3 lg:grid"><HomeSelect value={year} options={years} onChange={setYear} /><HomeSelect value={market} options={marketOptions} onChange={setMarket} />{!model ? <div className="col-span-2"><HomeSelect value={body} options={bodyOptions} onChange={setBody} /></div> : null}</div>
          <div className="relative mt-4"><button type="button" onClick={submit} className="avto-button h-[58px] w-full rounded-2xl pr-16 text-base font-black">Узнать Цену</button><button type="button" onClick={() => setMobileFiltersOpen(true)} className="absolute right-0 top-0 flex h-[58px] w-14 items-center justify-center rounded-r-2xl text-white lg:hidden" aria-label="Открыть дополнительные фильтры"><SlidersIcon /></button></div>
        </div>
      </section>

      <BuyerGallery images={buyers} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-stretch">
        <section className="ac-executor-block grid gap-5 rounded-[1.6rem] p-4 md:grid-cols-[minmax(0,1fr)_290px] md:items-center md:p-5"><div><h3 className="text-xl font-black">АвтоЦена — подбор автомобиля под ваш бюджет</h3><p className="mt-3 text-sm font-medium leading-7 text-white/60">Сервис помогает быстро понять, какой автомобиль можно привезти из Японии, Китая, Кореи, ОАЭ или Европы. Вы задаёте параметры, а система показывает реальные варианты и актуальный расчёт.</p><p className="mt-2 text-sm font-bold leading-6 text-white/75">Следующий шаг — менеджер TopAvto проверит автомобиль, подтвердит наличие и подготовит точный расчёт.</p></div><div className="ac-executor-logo flex min-h-32 items-center justify-center rounded-2xl p-5"><img src="/brands/topavto-logo.png" alt="TopAvto" className="max-h-24 w-full object-contain" /></div></section>
        <CurrencyRatesStrip rates={rates} variant="desktop" className="hidden lg:block" />
      </div>

      <section className="mt-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><div className="text-xs font-black uppercase tracking-[0.18em] text-red-400"><span className="lg:hidden">Автомобили в каталоге</span><span className="hidden lg:inline">Свежие предложения</span></div><h2 className="mt-2 text-3xl font-black md:text-5xl"><span className="lg:hidden">Свежие предложения</span><span className="hidden lg:inline">Автомобили в каталоге</span></h2></div>
          <div className="hidden gap-3 sm:grid-cols-[180px_220px_auto] lg:grid"><HomeSelect value={catalogMarket} options={marketOptions} onChange={setCatalogMarket} /><HomeSelect value={catalogMake} options={makeOptions} onChange={setCatalogMake} searchable searchPlaceholder="Найти марку" /><Link href={catalogHref} className="avto-button flex h-14 items-center justify-center rounded-2xl px-5 font-black">Показать</Link></div>
        </div>
        <CurrencyRatesStrip rates={rates} variant="mobile" className="mt-4 lg:hidden" />
        {marketGroups.length ? <div className="mt-7 space-y-8">{marketGroups.map((group) => {
          const meta = marketMeta[group.id];
          const params = new URLSearchParams({ market: group.id });
          if (catalogMake) params.set("make", catalogMake);
          if (electricOnly) params.set("fuel", "electric");
          return <section key={group.id}><div className="mb-4 flex items-end justify-between gap-3"><h3 className="flex min-w-0 items-center gap-2 text-[25px] font-black leading-none md:text-4xl"><CurrencyFlag currency={meta.currency} className="h-5 w-7 md:h-7 md:w-10" /><span>{meta.label}</span><span className="text-sm font-black text-[var(--ac-muted)] md:text-base">· {electricOnly ? group.total : marketCounts[group.id] || group.total}</span></h3><Link href={`/cars?${params}`} className="ac-market-all-link shrink-0 text-sm font-black md:text-base">Все →</Link></div><div className="ac-home-market-rail -mr-4 grid grid-flow-col auto-cols-[47%] gap-2.5 overflow-x-auto pr-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:mr-0 md:grid-flow-row md:grid-cols-4 md:overflow-visible md:pr-0">{group.items.map((item, index) => <div key={item.id} className={index >= 4 ? "md:hidden" : ""}><CatalogCard offer={item.raw} dense /></div>)}</div></section>;
        })}</div> : <div className="mt-6 rounded-2xl bg-white/[0.045] p-6">{electricOnly ? "Электромобили по выбранным параметрам пока не найдены." : "Каталог обновляется."}</div>}
        <BrandLogoRail brands={availableItems.map((item) => item.make)} />
      </section>
    </div>

    {mobileFiltersOpen ? <div className="fixed inset-0 z-[10040] bg-black/75 lg:hidden" onClick={() => setMobileFiltersOpen(false)}><div className="ac-home-filter-drawer ac-hide-scrollbar absolute inset-y-0 right-0 w-[min(92vw,390px)] overflow-y-auto bg-[var(--ac-surface)]" onClick={(event) => event.stopPropagation()}>
      <div className="ac-home-filter-drawer__header flex items-center justify-between"><h2 className="text-2xl font-black">Фильтры</h2><button type="button" onClick={() => setMobileFiltersOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ac-surface-2)] text-2xl" aria-label="Закрыть">×</button></div>
      <div className="ac-home-filter-drawer__fields">
        <div className="ac-home-filter-drawer__budget flex items-center justify-between gap-3"><BudgetLabel onInfo={() => setBudgetInfoOpen(true)} /><span className="flex items-center gap-2 text-[11px] font-black text-white/65"><span className="ac-pulse-dot ac-pulse-dot--status" aria-hidden="true"><span /></span>{count === null ? "Считаем варианты" : `Нашли ${count} вариантов`}</span></div>
        <div className="grid grid-cols-2 gap-3"><HomeSelect value={budget} options={budgets} onChange={setBudget} /><ElectricFilter checked={electricOnly} onChange={setElectric} /></div>
        <div className="grid grid-cols-2 gap-3"><HomeSelect value={make} options={makeOptions} onChange={(value) => { setMake(value); setModel(""); }} searchable searchPlaceholder="Найти марку" /><HomeSelect value={model} options={modelOptions} onChange={setModel} searchable searchPlaceholder="Найти модель" /></div>
        <PowerLimit checked={powerLimited} onChange={setPowerLimited} />
        <HomeSelect value={year} options={years} onChange={setYear} />
        <HomeSelect value={market} options={marketOptions} onChange={setMarket} />
        {!model ? <HomeSelect value={body} options={bodyOptions} onChange={setBody} /> : null}
      </div>
      <div className="ac-home-filter-drawer__actions"><button type="button" onClick={() => { setMobileFiltersOpen(false); submit(); }} className="avto-button h-14 w-full rounded-2xl text-base font-black">Узнать Цену</button></div>
    </div></div> : null}

    {budgetInfoOpen ? <div className="fixed inset-0 z-[15020] flex items-end justify-center bg-black/65 backdrop-blur-md lg:hidden" onClick={() => setBudgetInfoOpen(false)}><section className="w-full rounded-t-[28px] bg-[var(--ac-surface)] p-5 pb-[calc(24px+env(safe-area-inset-bottom))] text-[var(--ac-text)]" onClick={(event) => event.stopPropagation()}><div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[var(--ac-muted)]/35" /><div className="flex items-start justify-between gap-4"><div><div className="text-xs font-black uppercase tracking-[.16em] text-red-500">Бюджет</div><h2 className="mt-1 text-2xl font-black">Как работает подбор?</h2></div><button type="button" onClick={() => setBudgetInfoOpen(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ac-surface-2)] text-2xl" aria-label="Закрыть">×</button></div><p className="mt-4 text-base font-medium leading-7 text-[var(--ac-muted)]">Укажите бюджет — покажем, что можно привезти под ключ.</p><img src="/key-logo.png" alt="" className="mx-auto mt-5 max-h-44 w-full max-w-[270px] object-contain" /></section></div> : null}

    <style dangerouslySetInnerHTML={{ __html: `
      @media(min-width:1024px){.ac-budget-help{display:none!important}}
      @media(max-width:1023px){
        .ac-home-filter-drawer{padding:20px!important;background:var(--ac-surface)!important;color:var(--ac-text)!important}
        .ac-home-filter-drawer__header{margin:0 0 26px!important;padding:0!important}
        .ac-home-filter-drawer__fields{display:flex!important;flex-direction:column!important;gap:14px!important;margin:0!important;padding:0!important}
        .ac-home-filter-drawer__fields>*{margin:0!important}
        .ac-home-filter-drawer__budget{min-height:20px!important;margin-bottom:2px!important}
        .ac-home-filter-drawer__actions{margin-top:20px!important;padding:0!important}
        .ac-home-filter-drawer__actions>.avto-button{display:flex!important;width:100%!important;min-width:100%!important;margin:0!important;padding:0 1rem!important;align-items:center!important;justify-content:center!important;border-radius:1rem!important}
        .ac-home-filter-drawer__actions button+button{display:none!important}
      }
      @media(max-width:767px){.ac-home-page .ac-catalog-card,.ac-home-page .ac-catalog-card *,.ac-home-page .ac-home-market-rail,.ac-home-page .ac-home-market-rail>*{box-shadow:none!important}.ac-home-page .ac-catalog-card,.ac-home-page .ac-home-market-rail{filter:none!important}}
    ` }} />
  </main>;
}
