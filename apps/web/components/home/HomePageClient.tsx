"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandLogoRail } from "@/components/catalog/BrandLogoRail";
import { BuyerGallery } from "@/components/home/BuyerGallery";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { appendAttributionToSearchParams } from "@/lib/attribution";
import { canonicalCatalogBrand } from "@/lib/catalog/brands";
import { isCrediblePublicOffer } from "@/lib/catalog/offer-quality";
import { presentCatalogOffer } from "@/lib/catalog/presentation";

type Option = { value: string; label: string; min?: number; max?: number };
type Item = { raw: any; id: string; make: string; model: string; market: string; bodyType?: string };
type Rate = { currency: string; effectiveRate: number };

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
const marketMeta: Record<string, { label: string; flag: string }> = {
  korea: { label: "Корея", flag: "🇰🇷" },
  china: { label: "Китай", flag: "🇨🇳" },
  japan: { label: "Япония", flag: "🇯🇵" },
  uae: { label: "ОАЭ", flag: "🇦🇪" },
  europe: { label: "Европа", flag: "🇪🇺" },
};
const buyers = Array.from({ length: 15 }, (_, index) => `/buyers/${index + 1}.jpg`);
const benefits = [
  { icon: "fast", title: "Без регистрации", text: "Сразу получите первую выдачу по вашему бюджету." },
  { icon: "markets", title: "5 рынков", text: "Япония, Китай, Корея, ОАЭ и Европа в одном подборе." },
  { icon: "delivery", title: "Под ключ", text: "Доставка, таможня и оформление входят в структуру расчёта." },
];

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
  const search = useRef<HTMLInputElement>(null);
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
    if (searchable) requestAnimationFrame(() => search.current?.focus());
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [open, searchable]);

  const choose = (next: string) => { onChange(next); setOpen(false); setQuery(""); };
  return <div ref={root} className={`relative min-w-0 ${open ? "z-[230]" : "z-0"}`}>
    <button type="button" onClick={() => setOpen((current) => !current)} className="ac-filter-control flex h-14 w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-sm font-black" aria-expanded={open}><span className="min-w-0 truncate">{active?.label}</span><Chevron open={open} /></button>
    {open ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2">
      {searchable ? <div className="mb-1.5"><input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} className="ac-filter-search h-10 w-full rounded-xl px-3 text-sm font-bold outline-none" /></div> : null}
      <div className="ac-hide-scrollbar max-h-64 overflow-y-auto">{filtered.length ? filtered.map((option) => <button key={option.value || "any"} type="button" onClick={() => choose(option.value)} className={`ac-filter-option flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${value === option.value ? "is-active" : ""}`}><span className="truncate">{option.label}</span>{value === option.value ? <span>✓</span> : null}</button>) : <div className="px-3 py-5 text-center text-sm font-bold text-white/40">Ничего не найдено</div>}</div>
    </div> : null}
  </div>;
}

export default function HomePageClient() {
  const router = useRouter();
  const [budget, setBudget] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [market, setMarket] = useState("");
  const [body, setBody] = useState("");
  const [catalogMarket, setCatalogMarket] = useState("");
  const [catalogMake, setCatalogMake] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [marketCounts, setMarketCounts] = useState<Record<string, number>>({});
  const [count, setCount] = useState<number | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

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
          if (!isCrediblePublicOffer(raw as any)) continue;
          const offer = presentCatalogOffer(raw);
          unique.set(offer.id, { raw, id: offer.id, make: canonicalCatalogBrand(String(raw.make || "")), model: String(raw.model || ""), market: offer.market, bodyType: String(raw.bodyType || "") || undefined });
        }
        setItems([...unique.values()]);
        setRates(Array.isArray(responses[0]?.rates) ? responses[0].rates : []);
        setMarketCounts(Object.fromEntries(marketIds.map((id, index) => [id, Number(responses[index + 1]?.total || 0)])));
      } catch { if (!cancelled) setItems([]); }
    };
    loadCatalog();
    const interval = window.setInterval(loadCatalog, 60_000);
    const focus = () => loadCatalog();
    const visibility = () => { if (document.visibilityState === "visible") loadCatalog(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility); };
  }, []);

  useEffect(() => {
    if (!mobileFiltersOpen) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileFiltersOpen(false); };
    window.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = old; window.removeEventListener("keydown", keydown); };
  }, [mobileFiltersOpen]);

  const makeOptions = useMemo<Option[]>(() => {
    const values = new Map<string, string>();
    items.forEach((item) => values.set(item.make.toLocaleLowerCase("en-US"), item.make));
    return [{ value: "", label: "Марка" }, ...[...values.values()].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru")).map((label) => ({ value: label, label }))];
  }, [items]);
  const modelOptions = useMemo<Option[]>(() => {
    const values = new Map<string, string>();
    items.filter((item) => !make || item.make === make).forEach((item) => values.set(item.model, presentCatalogOffer(item.raw).modelLabel));
    return [{ value: "", label: "Модель" }, ...[...values].filter(([value]) => value).sort((a, b) => a[1].localeCompare(b[1], "ru")).map(([value, label]) => ({ value, label }))];
  }, [items, make]);
  const bodyOptions = useMemo<Option[]>(() => {
    const available = new Set(items.map((item) => item.bodyType).filter(Boolean));
    return [bodies[0], ...bodies.slice(1).filter((option) => available.has(option.value))];
  }, [items]);
  const selectedBudget = budgets.find((option) => option.value === budget) || budgets[0];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ pageSize: "1" });
      if (selectedBudget.min) params.set("budgetFrom", String(selectedBudget.min));
      if (selectedBudget.max) params.set("budgetTo", String(selectedBudget.max));
      if (make) params.set("make", make);
      if (model) params.set("model", model);
      if (market) params.set("market", market);
      if (body) params.set("bodyType", body);
      if (year === "older") params.set("yearTo", "2017"); else if (year) params.set("yearFrom", year);
      setCount(null);
      fetch(`/api/catalog/search?${params}`, { cache: "no-store" }).then((response) => response.json()).then((data) => setCount(Number(data?.total || 0))).catch(() => setCount(0));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [selectedBudget.min, selectedBudget.max, make, model, market, body, year]);

  const marketGroups = useMemo(() => marketIds
    .filter((id) => !catalogMarket || id === catalogMarket)
    .map((id) => ({ id, items: items.filter((item) => item.market === id && (!catalogMake || item.make === catalogMake)).slice(0, 6) }))
    .filter((group) => group.items.length), [items, catalogMarket, catalogMake]);

  const submit = () => {
    const params = new URLSearchParams();
    if (selectedBudget.min) params.set("budgetFrom", String(selectedBudget.min));
    if (selectedBudget.max) params.set("budget", String(selectedBudget.max));
    if (make) params.set("brand", make);
    if (model) params.set("model", model);
    if (market) params.set("market", market);
    if (body) params.set("body", body);
    if (year === "older") params.set("yearTo", "2017"); else if (year) params.set("yearFrom", year);
    appendAttributionToSearchParams(params);
    router.push(`/results${params.toString() ? `?${params}` : ""}`);
  };
  const rateMap = new Map(rates.map((rate) => [rate.currency, rate.effectiveRate]));

  return <main className="ac-home-page ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader />
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-16 md:px-8">
      <section className="ac-home-hero grid items-start gap-7 py-7 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-10 lg:py-12">
        <div><h1 className="max-w-4xl text-[44px] font-black leading-[.93] tracking-[-0.055em] sm:text-[64px] lg:text-[82px] xl:text-[96px]">Цена на авто под заказ</h1><p className="mt-5 text-lg font-medium text-white/75 md:text-xl">Укажите бюджет — покажем, что можно привезти под ключ.</p><div className="mt-7 hidden grid-cols-1 gap-4 lg:grid">{benefits.map((item) => <div key={item.title} className="flex items-center gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400"><BenefitIcon type={item.icon} /></div><div><div className="font-black">{item.title}</div><div className="mt-1 text-sm text-white/45">{item.text}</div></div></div>)}</div></div>
        <div id="form" className="ac-filter-panel rounded-[1.8rem] bg-white/[0.075] p-4 md:p-5"><div className="mb-3 flex items-center justify-between gap-3"><span className="text-xs font-black uppercase tracking-[0.16em] text-red-400">Бюджет</span><span className="flex items-center gap-2 text-[11px] font-black text-white/65"><span className="ac-pulse-dot ac-pulse-dot--status" aria-hidden="true"><span /></span>{count === null ? "Считаем варианты" : `Нашли ${count} вариантов`}</span></div><HomeSelect value={budget} options={budgets} onChange={setBudget} /><div className="mt-3 grid grid-cols-2 gap-3"><HomeSelect value={make} options={makeOptions} onChange={(value) => { setMake(value); setModel(""); }} searchable searchPlaceholder="Найти марку" /><HomeSelect value={model} options={modelOptions} onChange={setModel} searchable searchPlaceholder="Найти модель" /></div><div className="mt-3 hidden grid-cols-2 gap-3 lg:grid"><HomeSelect value={year} options={years} onChange={setYear} /><HomeSelect value={market} options={markets} onChange={setMarket} /><div className="col-span-2"><HomeSelect value={body} options={bodyOptions} onChange={setBody} /></div></div><div className="mt-4 grid grid-cols-[minmax(0,1fr)_58px] overflow-hidden rounded-2xl lg:block"><button type="button" onClick={submit} className="avto-button h-[58px] w-full rounded-none text-base font-black lg:rounded-2xl">Узнать Цену</button><button type="button" onClick={() => setMobileFiltersOpen(true)} className="ac-filter-more-button flex h-[58px] items-center justify-center border-l border-white/10 lg:hidden" aria-label="Открыть дополнительные фильтры"><SlidersIcon /></button></div></div>
      </section>

      <section className="ac-mobile-rates grid grid-cols-5 rounded-[1.4rem] px-2 py-4 lg:hidden">{[["🇯🇵", "JPY", 100], ["🇨🇳", "CNY", 1], ["🇰🇷", "KRW", 1000], ["🇦🇪", "AED", 1], ["🇪🇺", "EUR", 1]].map(([flag, currency, amount]) => <div key={String(currency)} className="text-center"><div className="text-2xl">{flag}</div><div className="text-[9px] font-black">{currency}</div><div className="text-[10px] font-bold text-white/60">{rateMap.has(String(currency)) ? `${(Number(rateMap.get(String(currency))) * Number(amount)).toFixed(2)} ₽` : "—"}</div></div>)}</section>

      <BuyerGallery images={buyers} />

      <section className="ac-executor-block mt-4 grid gap-5 rounded-[1.6rem] p-4 md:grid-cols-[minmax(0,1fr)_290px] md:items-center md:p-5"><div><h3 className="text-xl font-black">АвтоЦена — подбор автомобиля под ваш бюджет</h3><p className="mt-3 text-sm font-medium leading-7 text-white/60">Сервис помогает быстро понять, какой автомобиль можно привезти из Японии, Китая, Кореи, ОАЭ или Европы. Вы задаёте параметры, а система показывает реальные варианты и актуальный расчёт.</p><p className="mt-2 text-sm font-bold leading-6 text-white/75">Следующий шаг — менеджер TopAvto проверит автомобиль, подтвердит наличие и подготовит точный расчёт.</p></div><div className="ac-executor-logo flex min-h-32 items-center justify-center rounded-2xl p-5"><img src="/brands/topavto-logo.png" alt="TopAvto" className="max-h-24 w-full object-contain" /></div></section>

      <section className="mt-8"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="text-xs font-black uppercase tracking-[0.18em] text-red-400"><span className="lg:hidden">Автомобили в каталоге</span><span className="hidden lg:inline">Свежие предложения</span></div><h2 className="mt-2 text-3xl font-black md:text-5xl"><span className="lg:hidden">Свежие предложения</span><span className="hidden lg:inline">Автомобили в каталоге</span></h2></div><div className="hidden gap-3 sm:grid-cols-[180px_220px_auto] lg:grid"><HomeSelect value={catalogMarket} options={markets} onChange={setCatalogMarket} /><HomeSelect value={catalogMake} options={makeOptions} onChange={setCatalogMake} searchable searchPlaceholder="Найти марку" /><Link href={`/cars${catalogMarket || catalogMake ? `?${new URLSearchParams({ ...(catalogMarket ? { market: catalogMarket } : {}), ...(catalogMake ? { make: catalogMake } : {}) }).toString()}` : ""}`} className="avto-button flex h-14 items-center justify-center rounded-2xl px-5 font-black">Показать</Link></div></div>
        {marketGroups.length ? <div className="mt-7 space-y-8">{marketGroups.map((group) => { const meta = marketMeta[group.id]; const href = `/cars?market=${group.id}${catalogMake ? `&make=${encodeURIComponent(catalogMake)}` : ""}`; return <section key={group.id}><div className="mb-4 flex items-end justify-between gap-3"><h3 className="flex min-w-0 items-center gap-2 text-[25px] font-black leading-none md:text-4xl"><span aria-hidden="true">{meta.flag}</span><span>{meta.label}</span><span className="text-sm font-black text-[var(--ac-muted)] md:text-base">· {marketCounts[group.id] || group.items.length}</span></h3><Link href={href} className="shrink-0 text-sm font-black md:text-base">Все →</Link></div><div className="ac-home-market-rail -mr-4 grid grid-flow-col auto-cols-[47%] gap-2.5 overflow-x-auto pr-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:mr-0 md:grid-flow-row md:grid-cols-4 md:overflow-visible md:pr-0">{group.items.map((item, index) => <div key={item.id} className={index >= 4 ? "md:hidden" : ""}><CatalogCard offer={item.raw} dense /></div>)}</div></section>; })}</div> : <div className="mt-6 rounded-2xl bg-white/[0.045] p-6">Каталог обновляется.</div>}
        <BrandLogoRail brands={items.map((item) => item.make)} />
      </section>
    </div>

    {mobileFiltersOpen ? <div className="fixed inset-0 z-[10040] bg-black/75 lg:hidden" onClick={() => setMobileFiltersOpen(false)}><div className="ac-home-filter-drawer ac-hide-scrollbar absolute inset-y-0 right-0 w-[min(92vw,390px)] overflow-y-auto bg-[var(--ac-surface)] p-5" onClick={(event) => event.stopPropagation()}><div className="mb-6 flex items-center justify-between"><h2 className="text-2xl font-black">Фильтры</h2><button type="button" onClick={() => setMobileFiltersOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ac-surface-2)] text-2xl" aria-label="Закрыть">×</button></div><div className="grid gap-3"><HomeSelect value={year} options={years} onChange={setYear} /><HomeSelect value={market} options={markets} onChange={setMarket} /><HomeSelect value={body} options={bodyOptions} onChange={setBody} /></div><button type="button" onClick={() => { setMobileFiltersOpen(false); submit(); }} className="avto-button mt-6 h-14 w-full rounded-2xl text-base font-black">Узнать Цену</button></div></div> : null}
    <style dangerouslySetInnerHTML={{ __html: `@media(max-width:767px){.ac-home-page .ac-catalog-card,.ac-home-page .ac-catalog-card *,.ac-home-page .ac-home-market-rail,.ac-home-page .ac-home-market-rail>*{box-shadow:none!important}.ac-home-page .ac-catalog-card,.ac-home-page .ac-home-market-rail{filter:none!important}}` }} />
  </main>;
}
