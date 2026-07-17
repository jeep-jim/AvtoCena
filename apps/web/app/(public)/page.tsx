"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BrandLogoRail } from "@/components/catalog/BrandLogoRail";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { appendAttributionToSearchParams, captureAttributionFromBrowser, trackAttributionEvent } from "@/lib/attribution";
import { isCrediblePublicOffer } from "@/lib/catalog/offer-quality";
import { presentCatalogOffer } from "@/lib/catalog/presentation";

type BudgetOption = { value: string; label: string; min?: number; max?: number };
type SelectOption = { value: string; label: string };
type CatalogItem = { raw: any; id: string; make: string; model: string; market: string; year: number; body: string; totalRub: number; priceDeltaRub: number };
type PublicRate = { currency: string; effectiveRate: number; rateDate?: string };

const budgetOptions: BudgetOption[] = [
  { value: "", label: "Любой бюджет" },
  { value: "to-1500000", label: "до 1 500 000 ₽", max: 1_500_000 },
  { value: "to-2000000", label: "до 2 000 000 ₽", max: 2_000_000 },
  { value: "to-2500000", label: "до 2 500 000 ₽", max: 2_500_000 },
  { value: "to-3000000", label: "до 3 000 000 ₽", max: 3_000_000 },
  { value: "to-4000000", label: "до 4 000 000 ₽", max: 4_000_000 },
  { value: "to-5000000", label: "до 5 000 000 ₽", max: 5_000_000 },
  { value: "to-6000000", label: "до 6 000 000 ₽", max: 6_000_000 },
  { value: "from-6000000", label: "от 6 000 000 ₽", min: 6_000_000 },
];

const yearOptions: SelectOption[] = ["", "2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "older"].map((value) => ({
  value,
  label: value === "" ? "Год" : value === "older" ? "Старше 2018" : value,
}));

const marketOptions: SelectOption[] = [
  { value: "", label: "Страна" },
  { value: "japan", label: "Япония" },
  { value: "china", label: "Китай" },
  { value: "korea", label: "Корея" },
  { value: "uae", label: "ОАЭ" },
  { value: "europe", label: "Европа" },
];

const bodyOptions: SelectOption[] = [
  { value: "", label: "Кузов" },
  { value: "suv", label: "Кроссовер" },
  { value: "offroad", label: "Внедорожник" },
  { value: "sedan", label: "Седан" },
  { value: "wagon", label: "Универсал" },
  { value: "hatchback", label: "Хэтчбек" },
  { value: "liftback", label: "Лифтбек" },
  { value: "coupe", label: "Купе" },
  { value: "convertible", label: "Кабриолет" },
  { value: "minivan", label: "Минивэн" },
  { value: "pickup", label: "Пикап" },
  { value: "van", label: "Фургон" },
];

const buyerPhotos = Array.from({ length: 15 }, (_, index) => ({ src: `/buyers/${index + 1}.jpg`, alt: `Клиент TopAvto ${index + 1}` }));
const benefits = [
  { icon: "fast", title: "Без регистрации", text: "Сразу получите первую выдачу по вашему бюджету." },
  { icon: "markets", title: "5 рынков", text: "Япония, Китай, Корея, ОАЭ и Европа в одном подборе." },
  { icon: "delivery", title: "Под ключ", text: "Доставка, таможня и оформление входят в структуру расчёта." },
];
const mobileRateDefinitions = [
  { flag: "🇯🇵", currency: "JPY", amount: 100, unit: "100 ¥", label: "Япония" },
  { flag: "🇨🇳", currency: "CNY", amount: 1, unit: "1 ¥", label: "Китай" },
  { flag: "🇰🇷", currency: "KRW", amount: 1000, unit: "1000 ₩", label: "Корея" },
  { flag: "🇦🇪", currency: "AED", amount: 1, unit: "1 AED", label: "ОАЭ" },
  { flag: "🇪🇺", currency: "EUR", amount: 1, unit: "1 €", label: "Европа" },
];

function Chevron() { return <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function SearchIcon() { return <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.7" /><path d="M12 12L16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>; }
function BenefitIcon({ type }: { type: string }) {
  if (type === "fast") return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.5 2L5 13H11L10.5 22L19 10.5H13L13.5 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (type === "markets") return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" /><path d="M3.8 12H20.2M12 3.5C14.2 5.8 15.4 8.6 15.4 12C15.4 15.4 14.2 18.2 12 20.5C9.8 18.2 8.6 15.4 8.6 12C8.6 8.6 9.8 5.8 12 3.5Z" stroke="currentColor" strokeWidth="1.7" /></svg>;
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7H15V17H3V7ZM15 10H19L22 13V17H15V10Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="7" cy="18" r="2" stroke="currentColor" strokeWidth="2" /><circle cx="18" cy="18" r="2" stroke="currentColor" strokeWidth="2" /></svg>;
}

function SearchSelect({ value, onChange, options, placeholder, searchPlaceholder = "Поиск", searchable = true, filterKey }: { value: string; onChange: (value: string) => void; options: SelectOption[]; placeholder: string; searchPlaceholder?: string; searchable?: boolean; filterKey?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = options.find((item) => item.value === value);
  const filtered = useMemo(() => {
    if (!searchable) return options;
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return normalized ? options.filter((item) => item.label.toLocaleLowerCase("ru-RU").includes(normalized)) : options;
  }, [options, query, searchable]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    if (searchable) requestAnimationFrame(() => searchRef.current?.focus());
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [open, searchable]);

  const choose = (next: string) => { onChange(next); setOpen(false); setQuery(""); };
  return <div ref={rootRef} data-ac-filter-key={filterKey} data-ac-value={value} className={`relative min-w-0 ${open ? "z-[220]" : "z-0"}`}>
    <button type="button" onClick={() => setOpen((current) => !current)} className="ac-search-select soft-input flex h-14 w-full min-w-0 items-center justify-between gap-2 rounded-2xl px-4 text-left text-sm font-black transition" aria-expanded={open}><span className="min-w-0 truncate">{selected?.label || placeholder}</span><span className={`shrink-0 text-white/46 transition ${open ? "rotate-180" : ""}`}><Chevron /></span></button>
    {open ? <div className="ac-search-menu absolute left-0 right-0 top-[calc(100%+7px)] z-[220] overflow-hidden rounded-2xl bg-[#171922]">
      {searchable ? <div className="p-2.5"><div className="ac-search-box flex h-10 items-center gap-2 rounded-xl bg-white/[0.065] px-3 text-white/45"><SearchIcon /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} className="min-w-0 flex-1 bg-transparent text-sm font-bold text-white outline-none placeholder:text-white/28" /></div></div> : null}
      <div role="listbox" className={`ac-hide-scrollbar max-h-[270px] overflow-y-auto p-1.5 ${searchable ? "pt-0" : "pt-1.5"}`}>
        {filtered.length ? filtered.map((item) => <button key={item.value || "any"} type="button" role="option" aria-selected={item.value === value} data-value={item.value} onClick={() => choose(item.value)} className={`flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${item.value === value ? "bg-red-500 text-white" : "text-white/78 hover:bg-white/[0.07]"}`}><span className="truncate">{item.label}</span>{item.value === value ? <span>✓</span> : null}</button>) : <div className="px-3 py-6 text-center text-sm font-bold text-white/40">Ничего не найдено</div>}
      </div>
    </div> : null}
  </div>;
}

function BuyerGallery() {
  const [selected, setSelected] = useState<number | null>(null);
  const swipeStart = useRef<number | null>(null);
  const photos = [...buyerPhotos, ...buyerPhotos];
  const move = (offset: number) => setSelected((current) => current === null ? 0 : (current + offset + buyerPhotos.length) % buyerPhotos.length);
  useEffect(() => {
    if (selected === null) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); if (event.key === "ArrowRight") move(1); if (event.key === "ArrowLeft") move(-1); };
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = old; window.removeEventListener("keydown", key); };
  }, [selected]);
  return <section className="overflow-hidden"><h2 className="text-3xl font-black tracking-[-0.04em] md:text-5xl">Те, кто узнали — уже ездят!</h2><div className="buyer-gallery-mask mt-5 overflow-hidden"><div className="buyer-gallery-track flex w-max gap-3 md:gap-4">{photos.map((photo, index) => <button key={`${photo.src}-${index}`} type="button" onClick={() => setSelected(index % buyerPhotos.length)} className="h-[150px] w-[220px] shrink-0 overflow-hidden rounded-[1.35rem] bg-white/[0.04] sm:h-[180px] sm:w-[270px] lg:h-[205px] lg:w-[315px]"><img src={photo.src} alt={photo.alt} className="h-full w-full object-cover" /></button>)}</div></div>
    {selected !== null && typeof document !== "undefined" ? createPortal(<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#03050a]/95 p-4" onClick={() => setSelected(null)}><button type="button" className="absolute left-3 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-3xl text-white md:left-7" onClick={(event) => { event.stopPropagation(); move(-1); }}>‹</button><img src={buyerPhotos[selected].src} alt={buyerPhotos[selected].alt} className="max-h-[92dvh] max-w-[96vw] cursor-pointer rounded-2xl object-contain" onClick={(event) => { event.stopPropagation(); move(1); }} onPointerDown={(event) => { swipeStart.current = event.clientX; }} onPointerUp={(event) => { const start = swipeStart.current; swipeStart.current = null; if (start === null) return; const delta = event.clientX - start; if (Math.abs(delta) > 45) move(delta < 0 ? 1 : -1); }} /><button type="button" className="absolute right-3 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-3xl text-white md:right-7" onClick={(event) => { event.stopPropagation(); move(1); }}>›</button><button type="button" className="absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full bg-black/65 text-3xl text-white" onClick={() => setSelected(null)}>×</button><div className="absolute bottom-4 rounded-full bg-black/65 px-4 py-2 text-sm font-black text-white">{selected + 1} / {buyerPhotos.length}</div></div>, document.body) : null}
  </section>;
}

function ExecutorBlock() {
  return <section className="ac-executor-block mt-4 grid gap-5 rounded-[1.6rem] p-5 md:grid-cols-[minmax(0,1fr)_290px] md:items-center md:p-6"><div><h3 className="text-xl font-black">АвтоЦена — подбор автомобиля под ваш бюджет</h3><p className="mt-3 max-w-4xl text-sm font-medium leading-7 text-white/58 md:text-[15px]">Сервис помогает быстро понять, какой автомобиль можно привезти из Японии, Китая, Кореи, ОАЭ или Европы. Вы задаёте параметры, а система показывает реальные варианты и актуальный расчёт.</p><p className="mt-2 max-w-4xl text-sm font-bold leading-6 text-white/72 md:text-[15px]">Следующий шаг — менеджер TopAvto проверит выбранный автомобиль, подтвердит наличие и подготовит точный расчёт под ключ.</p></div><div className="ac-executor-logo flex min-h-32 items-center justify-center rounded-[1.3rem] p-5"><img src="/brands/topavto-logo.png" alt="TopAvto" className="ac-topavto-logo max-h-24 w-full object-contain" /></div></section>;
}

function MobileExchangeRates({ rates }: { rates: PublicRate[] }) {
  const rateMap = new Map(rates.map((rate) => [rate.currency, rate.effectiveRate]));
  const format = (currency: string, amount: number) => { const effectiveRate = Number(rateMap.get(currency) || 0); return effectiveRate ? new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(effectiveRate * amount) : "—"; };
  return <section className="ac-mobile-rates grid grid-cols-5 gap-1 rounded-[1.4rem] px-2 py-4 lg:hidden" aria-label="Текущие курсы валют рынков">{mobileRateDefinitions.map((item) => <div key={item.currency} className="flex min-w-0 flex-col items-center text-center" title={`${item.label}: ${item.currency}`}><span className="text-[24px] leading-none">{item.flag}</span><span className="mt-1 text-[9px] font-black uppercase tracking-[0.08em] text-white/48">{item.currency}</span><span className="mt-1 text-[10px] font-black leading-[1.15] sm:text-[11px]">{item.unit}</span><span className="mt-0.5 text-[10px] font-bold leading-[1.15] text-white/58 sm:text-[11px]">{format(item.currency, item.amount)} ₽</span></div>)}</section>;
}

function mapItem(raw: any): CatalogItem {
  const o = presentCatalogOffer(raw);
  return { raw, id: o.id, make: String(raw.make || ""), model: String(raw.model || ""), market: o.market, year: o.year, body: String(raw.bodyType || ""), totalRub: Number(o.totalRub || 0), priceDeltaRub: Number(raw.priceDeltaRub || 0) };
}

function stableScore(value: string) { let hash = 0; for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) >>> 0; return hash; }
function mixedMarketItems(source: CatalogItem[], limit = 6) {
  const marketOrder = ["korea", "china", "japan", "uae", "europe"];
  const buckets = new Map(marketOrder.map((market) => [market, source.filter((item) => item.market === market).sort((a, b) => {
    const directionA = Math.sign(a.priceDeltaRub); const directionB = Math.sign(b.priceDeltaRub);
    if (directionA !== directionB) return directionA - directionB;
    return stableScore(a.id) - stableScore(b.id);
  })]));
  const result: CatalogItem[] = [];
  let round = 0;
  while (result.length < limit && marketOrder.some((market) => (buckets.get(market)?.length || 0) > round)) {
    for (const market of marketOrder) { const item = buckets.get(market)?.[round]; if (item) result.push(item); if (result.length >= limit) break; }
    round++;
  }
  return result;
}

export default function HomePage() {
  const router = useRouter();
  const [budget, setBudget] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [market, setMarket] = useState("");
  const [body, setBody] = useState("");
  const [catalogMarket, setCatalogMarket] = useState("");
  const [catalogMake, setCatalogMake] = useState("");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [exchangeRates, setExchangeRates] = useState<PublicRate[]>([]);
  const [foundCount, setFoundCount] = useState<number | null>(null);
  const allowDemo = process.env.NODE_ENV !== "production" || process.env.ENABLE_DEMO_CATALOG === "true" || process.env.NEXT_PUBLIC_ENABLE_DEMO_CATALOG === "true";

  useEffect(() => {
    const attribution = captureAttributionFromBrowser();
    if (attribution.clickId) void trackAttributionEvent("visit", attribution, { landingPath: window.location.pathname });
    const requests = [
      fetch("/api/catalog/search?pageSize=24&sort=updatedAt&includeRates=1", { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
      ...["korea", "china", "japan", "uae", "europe"].map((marketId) => fetch(`/api/catalog/search?market=${marketId}&pageSize=24&sort=updatedAt`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null)),
    ];
    Promise.all(requests).then((responses) => {
      const unique = new Map<string, CatalogItem>();
      for (const raw of responses.flatMap((data) => Array.isArray(data?.items) ? data.items : [])) {
        if (!isCrediblePublicOffer(raw as any)) continue;
        const item = mapItem(raw);
        if (!unique.has(item.id)) unique.set(item.id, item);
      }
      setItems([...unique.values()]);
      const rates = Array.isArray(responses[0]?.rates) ? responses[0].rates : [];
      setExchangeRates(rates.filter((rate: any) => rate && typeof rate.currency === "string" && Number(rate.effectiveRate) > 0));
    }).catch(() => setItems([]));
  }, []);

  const makeOptions = useMemo<SelectOption[]>(() => {
    const map = new Map<string, string>();
    for (const item of items) { const label = presentCatalogOffer(item.raw).makeLabel; if (item.make && label) map.set(item.make, label); }
    return [{ value: "", label: "Марка" }, ...[...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru")).map(([value, label]) => ({ value, label }))];
  }, [items]);
  const modelOptions = useMemo<SelectOption[]>(() => {
    const map = new Map<string, string>();
    for (const item of items.filter((candidate) => !brand || candidate.make === brand)) { const label = presentCatalogOffer(item.raw).modelLabel; if (item.model && label) map.set(item.model, label); }
    return [{ value: "", label: "Модель" }, ...[...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru")).map(([value, label]) => ({ value, label }))];
  }, [items, brand]);
  const selectedBudget = budgetOptions.find((item) => item.value === budget) || budgetOptions[0];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ pageSize: "1", sort: "updatedAt" });
      if (selectedBudget.min) params.set("budgetFrom", String(selectedBudget.min));
      if (selectedBudget.max) params.set("budgetTo", String(selectedBudget.max));
      if (brand) params.set("make", brand); if (model) params.set("model", model); if (market) params.set("market", market); if (body) params.set("bodyType", body);
      if (year === "older") params.set("yearTo", "2017"); else if (year) params.set("yearFrom", year);
      setFoundCount(null);
      fetch(`/api/catalog/search?${params}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => setFoundCount(Number(data?.total || 0))).catch(() => setFoundCount(0));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [selectedBudget.min, selectedBudget.max, brand, model, market, body, year]);

  const catalogItems = useMemo(() => mixedMarketItems(items.filter((item) => (!catalogMarket || item.market === catalogMarket) && (!catalogMake || item.make === catalogMake)), 6), [items, catalogMarket, catalogMake]);
  const brandLabels = useMemo(() => makeOptions.filter((option) => option.value).map((option) => option.label), [makeOptions]);
  function resultsUrl() {
    const params = new URLSearchParams();
    if (selectedBudget.min) params.set("budgetFrom", String(selectedBudget.min)); if (selectedBudget.max) params.set("budget", String(selectedBudget.max));
    if (brand) params.set("brand", brand); if (model) params.set("model", model); if (market) params.set("market", market); if (body) params.set("body", body);
    if (year === "older") params.set("yearTo", "2017"); else if (year) params.set("yearFrom", year);
    appendAttributionToSearchParams(params); return `/results?${params}`;
  }
  const catalogHref = useMemo(() => { const params = new URLSearchParams(); if (catalogMarket) params.set("market", catalogMarket); if (catalogMake) params.set("make", catalogMake); return `/cars${params.toString() ? `?${params}` : ""}`; }, [catalogMarket, catalogMake]);

  return <main className="ac-home-page ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white"><PublicHeader /><Link href="/cars" className="sr-only">Каталог</Link><div className="mx-auto w-full max-w-[1500px] px-4 pb-16 md:px-8">
    <section className="ac-home-hero grid items-start gap-7 py-7 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-10 lg:py-12"><div><h1 className="max-w-4xl text-[44px] font-black leading-[.93] tracking-[-0.055em] sm:text-[64px] lg:text-[82px] xl:text-[96px]">Цена на авто под заказ</h1><p className="mt-5 text-lg font-medium text-white/75 md:text-xl">Укажите параметры — покажем, что можно привезти под ключ.</p><div className="mt-7 hidden grid-cols-1 gap-4 lg:grid">{benefits.map((item) => <div key={item.title} className="flex items-center gap-4"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10 text-red-400"><BenefitIcon type={item.icon} /></div><div><div className="font-black">{item.title}</div><div className="mt-1 text-sm text-white/45">{item.text}</div></div></div>)}</div></div>
      <div id="form" className="ac-filter-panel rounded-[1.8rem] bg-white/[0.075] p-4 md:p-5"><div className="mb-3 flex items-center justify-between gap-3"><div className="text-xs font-black uppercase tracking-[0.16em] text-red-200">Бюджет</div><div className="flex items-center gap-2 rounded-full bg-black/18 px-3 py-1.5 text-[11px] font-black text-white/72"><span className="ac-pulse-dot ac-pulse-dot--status"><span /></span><span>{foundCount === null ? "Считаем варианты" : `Нашли ${foundCount} вариантов`}</span></div></div><SearchSelect filterKey="budget" value={budget} onChange={setBudget} options={budgetOptions.map(({ value, label }) => ({ value, label }))} placeholder="Любой бюджет" searchable={false} /><div className="mt-3 grid grid-cols-2 gap-3"><SearchSelect filterKey="make" value={brand} onChange={(next) => { setBrand(next); setModel(""); }} options={makeOptions} placeholder="Марка" searchPlaceholder="Найти марку" /><SearchSelect filterKey="model" value={model} onChange={setModel} options={modelOptions} placeholder="Модель" searchPlaceholder="Найти модель" /><SearchSelect filterKey="year" value={year} onChange={setYear} options={yearOptions} placeholder="Год" searchable={false} /><SearchSelect filterKey="market" value={market} onChange={setMarket} options={marketOptions} placeholder="Страна" searchable={false} /><div className="col-span-2"><SearchSelect filterKey="body" value={body} onChange={setBody} options={bodyOptions} placeholder="Кузов" searchable={false} /></div></div><button type="button" onClick={() => router.push(resultsUrl())} className="avto-button mt-4 flex h-[58px] w-full items-center justify-center rounded-2xl text-base font-black">Узнать Цену</button></div>
    </section>
    <MobileExchangeRates rates={exchangeRates} />
    <section className="mt-8"><BuyerGallery /><ExecutorBlock /></section>
    <section className="mt-6 pt-6" data-demo-enabled={allowDemo ? "true" : "false"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="text-xs font-black uppercase tracking-[0.18em] text-red-300">Свежие предложения</div><h2 className="mt-2 text-3xl font-black tracking-[-0.04em] md:text-5xl">Автомобили в каталоге</h2></div><div className="grid gap-3 sm:grid-cols-[180px_220px_auto]"><SearchSelect value={catalogMarket} onChange={setCatalogMarket} options={marketOptions} placeholder="Страна" searchable={false} /><SearchSelect value={catalogMake} onChange={setCatalogMake} options={makeOptions} placeholder="Марка" searchPlaceholder="Найти марку" /><Link href={catalogHref} className="avto-button flex h-14 items-center justify-center rounded-2xl px-5 font-black">Показать</Link></div></div>
      {catalogItems.length ? <div className="ac-hide-scrollbar mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-3">{catalogItems.map((item) => <div key={item.id} className="w-[82vw] max-w-[360px] shrink-0 snap-start md:w-auto md:max-w-none"><CatalogCard offer={item.raw} compact /></div>)}</div> : <div className="mt-6 rounded-[1.6rem] bg-white/[0.045] p-6 text-sm font-bold text-white/58">Каталог обновляется. Свежие варианты появятся после импорта рынка.</div>}
      <BrandLogoRail brands={brandLabels} />
    </section>
  </div></main>;
}
