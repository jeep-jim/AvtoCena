"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandLogoRail } from "@/components/catalog/BrandLogoRail";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { CatalogMarketFlag } from "@/components/catalog/CatalogMarketFlag";
import { CurrencyRatesStrip } from "@/components/catalog/CurrencyRatesStrip";
import type { PublicCurrencyRate } from "@/components/catalog/PriceTrend";
import { VehicleModelSearch } from "@/components/catalog/VehicleModelSearch";
import { BuyerGallery } from "@/components/home/BuyerGallery";
import { CitySelector } from "@/components/home/CitySelector";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { AFFILIATE_LINK_REL, AUTOCREDIT_AFFILIATE_URL, OSAGO_AFFILIATE_URL } from "@/lib/affiliate-links";
import { appendAttributionToSearchParams } from "@/lib/attribution";
import { canonicalCatalogBrand } from "@/lib/catalog/brands";
import { presentCatalogOffer } from "@/lib/catalog/presentation";
import { CATALOG_MARKET_LABELS, PUBLIC_CATALOG_MARKETS } from "@/lib/catalog/runtime-config";

type Option = { value: string; label: string; min?: number; max?: number };
type Item = { raw: any; id: string; make: string; model: string; market: string; bodyType?: string; fuel?: string };
type Props = {
  initialCity?: string;
  initialOffers?: any[];
  initialMarketCounts?: Record<string, number>;
  initialCount?: number;
};

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
const years: Option[] = [
  { value: "", label: "Год" },
  ...[2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018].map((value) => ({ value: String(value), label: String(value) })),
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
const marketIds = [...PUBLIC_CATALOG_MARKETS];
const markets: Option[] = [{ value: "", label: "Страна" }, ...marketIds.map((value) => ({ value, label: CATALOG_MARKET_LABELS[value] }))];
const buyers = Array.from({ length: 24 }, (_, index) => `/buyers/${index + 1}.jpg`);
const benefits = [
  { icon: "approved", title: "Без регистрации", text: "Сразу получите первую выдачу по вашему бюджету." },
  { icon: "markets", title: "7 рынков", text: "Япония, Китай, Корея, ОАЭ, Европа, Грузия и Кыргызстан в одном подборе." },
  { icon: "delivery", title: "Под ключ", text: "Доставка, таможня и оформление входят в структуру расчёта." },
];

function cleanFuel(value: unknown) { return String(value || "").trim().toLocaleLowerCase("ru-RU"); }
function isElectricOffer(value: { fuel?: string; raw?: any }) {
  const fuel = cleanFuel(value.fuel || value.raw?.fuel || value.raw?.engineType);
  return fuel === "electric" || fuel === "электро" || fuel === "электромобиль" || fuel === "bev";
}
function toItem(raw: any): Item | null {
  // `/api/catalog/home` and the SSR snapshot only expose rows already admitted by
  // the canonical public publisher. Re-running deep source/photo validation in
  // the browser breaks compact projection rows because their private provenance
  // was intentionally removed. Trust the public read model and validate only the
  // fields the homepage actually renders.
  const offer = presentCatalogOffer(raw);
  const id = String(offer.id || raw?.id || "").trim();
  const make = canonicalCatalogBrand(String(offer.makeLabel || raw?.make || ""));
  const model = String(offer.modelLabel || raw?.model || "").trim();
  const market = String(offer.market || raw?.market || "").trim();
  if (!id || !make || !model || !marketIds.some((marketId) => String(marketId) === market)) return null;
  return { raw, id, make, model, market, bodyType: String(raw?.bodyType || "") || undefined, fuel: String(raw?.fuel || "") || undefined };
}

function balancedMarketItems(items: Item[], limit = 6) {
  const buckets = new Map<string, Item[]>();
  for (const item of items) {
    const key = `${item.make.toLocaleLowerCase("en-US")}::${item.model.toLocaleLowerCase("en-US")}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const groups = [...buckets.values()];
  const output: Item[] = [];
  for (let depth = 0; output.length < limit; depth++) {
    let added = false;
    for (const group of groups) {
      const item = group[depth];
      if (!item) continue;
      output.push(item);
      added = true;
      if (output.length >= limit) break;
    }
    if (!added) break;
  }
  return output;
}
async function loadFuelOffers(fuel: string) {
  const loadMarket = async (market: string) => {
    const first = await fetch(`/api/catalog/search?market=${market}&fuel=${encodeURIComponent(fuel)}&pageSize=48&page=1&sort=updatedAt`, { cache: "no-store" }).then((response) => response.json());
    const pages = Math.max(1, Math.ceil(Number(first?.total || 0) / 48));
    const rest = pages > 1 ? await Promise.all(Array.from({ length: pages - 1 }, (_, index) => fetch(`/api/catalog/search?market=${market}&fuel=${encodeURIComponent(fuel)}&pageSize=48&page=${index + 2}&sort=updatedAt`, { cache: "no-store" }).then((response) => response.json()))) : [];
    return [first, ...rest].flatMap((response) => Array.isArray(response?.items) ? response.items : []);
  };
  return (await Promise.all(marketIds.map(loadMarket))).flat();
}
function Chevron({ open = false }: { open?: boolean }) { return <svg className={`shrink-0 transition ${open ? "rotate-180" : ""}`} width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function SlidersIcon() { return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7H20M4 17H20M8 4V10M16 14V20" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /><circle cx="8" cy="7" r="2" fill="currentColor" /><circle cx="16" cy="17" r="2" fill="currentColor" /></svg>; }
function BenefitIcon({ type }: { type: string }) {
  if (type === "approved") return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7.5 10.5 11 3.8c.5-.9 1.8-.8 2.1.2.4 1.4.2 2.8-.4 4.1H18a2 2 0 0 1 1.9 2.6l-1.7 6a3 3 0 0 1-2.9 2.2H8.5a2 2 0 0 1-2-2v-5.2c0-.5.4-1 .9-1.2Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M3.5 10.5h3v8h-3z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" /></svg>;
  if (type === "markets") return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" /><path d="M3.8 12H20.2M12 3.5C14.2 5.8 15.4 8.6 15.4 12C15.4 15.4 14.2 18.2 12 20.5C9.8 18.2 8.6 15.4 8.6 12C8.6 8.6 9.8 5.8 12 3.5Z" stroke="currentColor" strokeWidth="1.7" /></svg>;
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7H15V17H3V7ZM15 10H19L22 13V17H15V10Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="7" cy="18" r="2" stroke="currentColor" strokeWidth="2" /><circle cx="18" cy="18" r="2" stroke="currentColor" strokeWidth="2" /></svg>;
}

function HomeSelect({ value, options, onChange, searchable = false, searchPlaceholder = "Поиск", emptyLabel = "" }: { value: string; options: Option[]; onChange: (value: string) => void; searchable?: boolean; searchPlaceholder?: string; emptyLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const active = options.find((option) => option.value === value) || options[0];
  const filtered = useMemo(() => { const normalized = query.trim().toLocaleLowerCase("ru-RU"); return normalized ? options.filter((option) => option.label.toLocaleLowerCase("ru-RU").includes(normalized)) : options; }, [options, query]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside); window.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [open]);
  const choose = (next: string) => { onChange(next); setOpen(false); setQuery(""); };
  return <div ref={root} className={`relative min-w-0 ${open ? "z-[230]" : "z-0"}`}>
    <button type="button" onClick={() => setOpen((current) => !current)} className="ac-filter-control flex h-14 w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-sm font-black" aria-expanded={open}><span className="min-w-0 truncate">{!value && emptyLabel ? emptyLabel : active?.label}</span><Chevron open={open} /></button>
    {open ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2">{searchable ? <div className="mb-1.5"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} className="ac-filter-search h-10 w-full rounded-xl px-3 text-sm font-bold outline-none" /></div> : null}<div className="ac-hide-scrollbar max-h-64 overflow-y-auto">{filtered.length ? filtered.map((option) => <button key={option.value || "any"} type="button" onClick={() => choose(option.value)} className={`ac-filter-option flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${value === option.value ? "is-active" : ""}`}><span className="truncate">{option.label}</span>{value === option.value ? <span>✓</span> : null}</button>) : <div className="px-3 py-5 text-center text-sm font-bold text-white/40">Ничего не найдено</div>}</div></div> : null}
  </div>;
}
function MobileBudgetPicker({ value, options, onChange }: { value: string; options: Option[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tradeIn, setTradeIn] = useState(false);
  const [tradeInfoOpen, setTradeInfoOpen] = useState(false);
  const active = options.find((option) => option.value === value) || options[0];
  const choose = (next: string) => { onChange(next); setTradeInfoOpen(false); setOpen(false); };

  return <>
    <button type="button" onClick={() => setOpen((current) => !current)} className="ac-filter-control flex h-14 w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-sm font-black" aria-expanded={open}>
      <span className="min-w-0 whitespace-nowrap">{value ? active?.label : "Бюджет"}</span>{!value ? <Chevron open={!open} /> : null}
    </button>
    {open ? <div className="ac-budget-picker-overlay absolute inset-0 z-[320] overflow-hidden rounded-[1.8rem] p-2.5 backdrop-blur-md lg:hidden" style={{ border: "0", outline: "none", boxShadow: "none" }}>
      {tradeInfoOpen ? <div className="relative h-full w-full">
        <button type="button" onClick={() => setTradeInfoOpen(false)} className="absolute left-1 top-1 z-10 px-2 py-1 text-[11px] font-black text-[var(--ac-muted)]" aria-label="Вернуться к выбору бюджета">← Назад</button>
        <div className="flex h-full w-full items-center justify-center px-6 text-center text-[13px] font-bold leading-5 text-[var(--ac-text)]"><span>Условия по трейд-ин уточняются индивидуально с менеджером дилера в вашем городе.</span></div>
      </div> : <div className="grid h-full grid-cols-2 grid-rows-5 gap-1.5">
        {options.map((option) => <button key={option.value || "any"} type="button" onClick={() => choose(option.value)} className={`ac-filter-option flex min-h-0 items-center rounded-xl px-3 py-1.5 text-left text-[11px] font-black leading-tight ${value === option.value ? "is-active" : ""}`}>
          <span className="truncate">{option.label}</span>
        </button>)}
        <div className="ac-filter-option flex min-h-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-black leading-tight">
          <button type="button" onClick={() => setTradeIn((current) => !current)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-pressed={tradeIn}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[10px] font-black" style={{ background: tradeIn ? "#ff353d" : "var(--ac-surface-3)", border: tradeIn ? "1px solid #ff353d" : "1px solid rgba(103,113,130,.55)", color: tradeIn ? "#fff" : "transparent" }}>✓</span>
            <span className="truncate">Трейд-ин</span>
          </button>
          <button type="button" onClick={() => setTradeInfoOpen(true)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-[var(--ac-muted)]" style={{ background: "var(--ac-surface-3)", border: "1px solid rgba(103,113,130,.45)" }} aria-label="Условия трейд-ин">?</button>
        </div>
      </div>}
    </div> : null}
  </>;
}

function ElectricFilter({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) { return <label className="ac-filter-control ac-electric-filter flex h-14 cursor-pointer items-center gap-2 rounded-2xl px-3 text-sm font-black"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" /><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sm transition" style={{ background: checked ? "#ffd21f" : "var(--ac-surface-3)", border: checked ? "1px solid #ffd21f" : "1px solid rgba(103,113,130,.55)", color: checked ? "#171a21" : "transparent" }}>✓</span><span className="text-[17px] leading-none text-[#ffd21f]" aria-hidden="true">⚡</span><span className="truncate">Электро</span></label>; }
function PowerLimit({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const [infoOpen, setInfoOpen] = useState(false); const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!infoOpen) return; const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setInfoOpen(false); }; document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside); }, [infoOpen]);
  return <div ref={root} className={`relative ${infoOpen ? "z-[250]" : "z-0"}`}><label className="ac-filter-control ac-power-limit flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl px-4 pr-14 text-sm font-black"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" /><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-sm transition" style={{ background: checked ? "#ff353d" : "var(--ac-surface-3)", border: checked ? "1px solid #ff353d" : "1px solid rgba(103,113,130,.55)", color: checked ? "#fff" : "transparent" }}>✓</span><span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"><span>До 160 л.с.</span><span className="text-[11px] font-black text-red-500">свыше — полный утильсбор</span></span></label><button type="button" onClick={() => setInfoOpen((current) => !current)} className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-sm font-black" style={{ background: "var(--ac-surface-3)", border: "1px solid rgba(103,113,130,.45)" }} aria-label="Почему есть фильтр до 160 лошадиных сил">?</button>{infoOpen ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+8px)] rounded-2xl p-4 text-sm font-bold leading-6"><div className="font-black">Почему до 160 л.с.?</div><p className="mt-2 text-[var(--ac-muted)]">Мощность влияет на коэффициент утилизационного сбора. Для электромобилей и гибридов применяется расчётная мощность по документам.</p></div> : null}</div>;
}
function BudgetLabel({ onInfo }: { onInfo: () => void }) { return <span className="inline-flex shrink-0 items-center gap-1 text-xs font-black uppercase tracking-[0.16em] text-red-400"><span>Бюджет</span><button type="button" onClick={onInfo} className="ac-budget-help flex h-5 w-5 items-center justify-center rounded-full bg-red-500/12 text-[11px] font-black normal-case tracking-normal lg:hidden" aria-label="Как работает подбор по бюджету">?</button></span>; }

function CatalogLoadingSkeleton() {
  return <div className="mt-7 space-y-8" role="status" aria-live="polite" aria-label="Загружаем предложения каталога">
    {marketIds.map((market) => <section key={market}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-[25px] font-black leading-none md:text-4xl"><CatalogMarketFlag market={market} className="h-5 w-7 md:h-6 md:w-9" /><span>{CATALOG_MARKET_LABELS[market]}</span><span className="h-4 w-12 animate-pulse rounded-full bg-white/10" aria-hidden="true" /></h3>
        <span className="text-sm font-black text-white/35 md:text-base">Загружаем…</span>
      </div>
      <div className="ac-home-market-rail -mr-4 grid grid-flow-col auto-cols-[47%] gap-2.5 overflow-hidden pr-4 [scrollbar-width:none] md:mr-0 md:grid-flow-row md:grid-cols-4 md:pr-0" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="min-h-[330px] animate-pulse overflow-hidden rounded-[1.4rem] border border-white/[0.06] bg-white/[0.045]">
          <div className="h-40 bg-white/[0.055] md:h-48" />
          <div className="space-y-3 p-4"><div className="h-5 w-4/5 rounded bg-white/10" /><div className="h-4 w-2/5 rounded bg-white/[0.07]" /><div className="h-8 w-3/5 rounded bg-white/10" /><div className="h-4 w-full rounded bg-white/[0.06]" /></div>
        </div>)}
      </div>
    </section>)}
  </div>;
}

export default function HomePageClient({ initialCity = "", initialOffers = [], initialMarketCounts = {}, initialCount }: Props) {
  const router = useRouter();
  const skipInitialCountFetch = useRef(true);
  const [city, setCity] = useState(initialCity); const [budget, setBudget] = useState(""); const [make, setMake] = useState(""); const [model, setModel] = useState(""); const [year, setYear] = useState(""); const [market, setMarket] = useState(""); const [body, setBody] = useState("");
  const [powerLimited, setPowerLimited] = useState(false); const [electricOnly, setElectricOnly] = useState(false); const [fuelItems, setFuelItems] = useState<Item[] | null>(null); const [catalogMarket, setCatalogMarket] = useState(""); const [catalogMake, setCatalogMake] = useState("");
  const [items, setItems] = useState<Item[]>(() => initialOffers.flatMap((raw) => { const item = toItem(raw); return item ? [item] : []; })); const [knowledgeMakes, setKnowledgeMakes] = useState<string[]>([]); const [rates] = useState<PublicCurrencyRate[]>([]); const [marketCounts, setMarketCounts] = useState<Record<string, number>>(initialMarketCounts); const [count, setCount] = useState<number | null>(Number.isFinite(initialCount) ? Number(initialCount) : null); const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">(initialOffers.length ? "ready" : "loading"); const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false); const [budgetInfoOpen, setBudgetInfoOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadCatalog = async () => {
      const stamp = Date.now();
      try {
        const [catalogPayload, makePayload] = await Promise.all([
          fetch(`/api/catalog/home?_=${stamp}`, { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error("catalog_home_failed"); return response.json(); }),
          fetch(`/api/catalog/models?scope=makes&limit=500&_=${stamp}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : { items: [] }).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        const unique = new Map<string, Item>();
        (Array.isArray(catalogPayload?.items) ? catalogPayload.items : []).forEach((raw: any) => { const item = toItem(raw); if (item) unique.set(item.id, item); });
        const incomingItems = [...unique.values()];
        const incomingCounts = catalogPayload?.marketCounts && typeof catalogPayload.marketCounts === "object" ? catalogPayload.marketCounts as Record<string, number> : {};
        // A current-read-model shard can briefly lag the immutable public manifest
        // during publication. Never replace a visible market with an empty/partial
        // browser refresh: keep its last known cards until the new shard is ready.
        setItems((previousItems) => marketIds.flatMap((marketId) => {
          const nextMarketItems = incomingItems.filter((item) => item.market === marketId);
          const previousMarketItems = previousItems.filter((item) => item.market === marketId);
          return nextMarketItems.length ? nextMarketItems : previousMarketItems;
        }));
        setMarketCounts((previousCounts) => Object.fromEntries(marketIds.map((marketId) => {
          const incomingCount = Math.max(0, Number(incomingCounts[marketId] || 0));
          const previousCount = Math.max(0, Number(previousCounts[marketId] || 0));
          return [marketId, incomingCount > 0 ? incomingCount : previousCount];
        })));
        setCount((previousCount) => {
          const incomingTotal = Math.max(0, Number(catalogPayload?.total || 0));
          return incomingTotal > 0 ? incomingTotal : previousCount;
        });
        setKnowledgeMakes((Array.isArray(makePayload?.items) ? makePayload.items : []).map((item: any) => String(item?.value || item?.label || "")).filter(Boolean));
        setCatalogStatus("ready");
      } catch { if (!cancelled) setCatalogStatus((current) => current === "loading" ? "error" : current); }
    };
    loadCatalog(); const interval = window.setInterval(loadCatalog, 60_000); const focus = () => loadCatalog(); const visibility = () => { if (document.visibilityState === "visible") loadCatalog(); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", visibility);
    return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    if (!electricOnly) { setFuelItems(null); return; }
    let cancelled = false;
    loadFuelOffers("electric").then((rawItems) => { if (cancelled) return; const unique = new Map<string, Item>(); rawItems.forEach((raw) => { const item = toItem(raw); if (item) unique.set(item.id, item); }); setFuelItems([...unique.values()]); }).catch(() => { if (!cancelled) setFuelItems([]); });
    return () => { cancelled = true; };
  }, [electricOnly]);
  useEffect(() => { if (!mobileFiltersOpen) return; const old = document.body.style.overflow; document.body.style.overflow = "hidden"; const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileFiltersOpen(false); }; window.addEventListener("keydown", keydown); return () => { document.body.style.overflow = old; window.removeEventListener("keydown", keydown); }; }, [mobileFiltersOpen]);
  useEffect(() => { if (model && body) setBody(""); }, [model, body]);

  const availableItems = useMemo(() => electricOnly ? fuelItems || items.filter(isElectricOffer) : items, [electricOnly, fuelItems, items]);
  const makeOptions = useMemo<Option[]>(() => { const values = new Map<string, string>(); const source = electricOnly ? availableItems.map((item) => item.make) : knowledgeMakes.length ? knowledgeMakes : availableItems.map((item) => item.make); source.forEach((item) => values.set(item.toLocaleLowerCase("en-US"), item)); return [{ value: "", label: "Марка" }, ...[...values.values()].sort((a, b) => a.localeCompare(b, "ru")).map((label) => ({ value: label, label }))]; }, [availableItems, electricOnly, knowledgeMakes]);
  const bodyOptions = useMemo<Option[]>(() => { const available = new Set(availableItems.map((item) => item.bodyType).filter(Boolean)); return [bodies[0], ...bodies.slice(1).filter((option) => !electricOnly || available.has(option.value))]; }, [availableItems, electricOnly]);
  const marketOptions = useMemo<Option[]>(() => { if (!electricOnly) return markets; const available = new Set(availableItems.map((item) => item.market)); return [markets[0], ...markets.slice(1).filter((option) => available.has(option.value))]; }, [availableItems, electricOnly]);
  const selectedBudget = budgets.find((option) => option.value === budget) || budgets[0];

  useEffect(() => {
    if (skipInitialCountFetch.current) { skipInitialCountFetch.current = false; return; }
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ pageSize: "1" });
      if (selectedBudget.min) params.set("budgetFrom", String(selectedBudget.min)); if (selectedBudget.max) params.set("budgetTo", String(selectedBudget.max)); if (make) params.set("make", make); if (model) params.set("model", model); if (market) params.set("market", market); if (body && !model) params.set("bodyType", body); if (year === "older") params.set("yearTo", "2017"); else if (year) params.set("yearFrom", year); if (powerLimited) params.set("powerTo", "160"); if (electricOnly) params.set("fuel", "electric");
      setCount(null); fetch(`/api/catalog/search?${params}`, { cache: "no-store" }).then((response) => response.json()).then((data) => setCount(Number(data?.total || 0))).catch(() => setCount(0));
    }, 180); return () => window.clearTimeout(timer);
  }, [selectedBudget.min, selectedBudget.max, make, model, market, body, year, powerLimited, electricOnly]);

  const marketGroups = useMemo(() => marketIds.filter((id) => !catalogMarket || id === catalogMarket).map((id) => { const matches = availableItems.filter((item) => item.market === id && (!catalogMake || item.make === catalogMake)); return { id, total: matches.length, items: balancedMarketItems(matches, 6) }; }), [availableItems, catalogMarket, catalogMake]);
  const setElectric = (checked: boolean) => { setElectricOnly(checked); setFuelItems(null); setMake(""); setModel(""); setBody(""); setMarket(""); setCatalogMake(""); setCatalogMarket(""); };
  const submit = () => { const params = new URLSearchParams(); if (selectedBudget.min) params.set("budgetFrom", String(selectedBudget.min)); if (selectedBudget.max) params.set("budget", String(selectedBudget.max)); if (make) params.set("make", make); if (model) params.set("model", model); if (market) params.set("market", market); if (body && !model) params.set("bodyType", body); if (year === "older") params.set("yearTo", "2017"); else if (year) params.set("yearFrom", year); if (powerLimited) params.set("powerTo", "160"); if (electricOnly) params.set("fuel", "electric"); if (city) params.set("city", city); appendAttributionToSearchParams(params); router.push(`/cars${params.toString() ? `?${params}` : ""}`); };
  const modelSearch = <VehicleModelSearch value={model} make={make} placeholder="Модель" onValueChange={setModel} onMakeChange={setMake} onSubmit={submit} />;

  return <main className="ac-home-page ac-page-copy min-h-screen overflow-x-hidden bg-[#0f172a] text-white">
    <PublicHeader />
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-16 md:px-8">
      <section className="ac-home-hero grid items-start gap-7 pb-3 pt-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-10 lg:py-12">
        <div><h1 className="max-w-5xl text-[42px] font-black leading-[.93] tracking-[-0.055em] sm:text-[64px] lg:text-[78px] xl:text-[90px]"><span>Цена на авто под заказ</span> <CitySelector value={city} onChange={setCity} /></h1><p className="mt-5 hidden text-lg font-medium text-white/75 lg:block lg:text-xl">Укажите Ваш город и бюджет — покажем, что можно привезти под ключ.</p><div className="mt-7 hidden grid-cols-1 gap-4 lg:grid">{benefits.map((item) => <div key={item.title} className="flex items-center gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400"><BenefitIcon type={item.icon} /></div><div><div className="font-black">{item.title}</div><div className="mt-1 text-sm text-white/45">{item.text}</div></div></div>)}</div></div>
        <div id="form" className="ac-filter-panel relative flex min-h-0 flex-col overflow-hidden rounded-[1.8rem] bg-white/[0.075] p-4 md:p-5 lg:min-h-[438px] lg:overflow-visible">
          <div className="mb-3 flex items-center justify-between gap-3 lg:mb-4"><BudgetLabel onInfo={() => setBudgetInfoOpen(true)} /><span className="flex items-center gap-2 text-[11px] font-black text-white/65"><span className="ac-pulse-dot ac-pulse-dot--status"><span /></span>{count === null ? "Считаем варианты" : `Нашли ${count} вариантов`}</span></div>
          <div className="hidden w-full min-w-0 max-w-none lg:block"><HomeSelect value={budget} options={budgets} onChange={setBudget} /></div>
          <div className="mt-2 flex flex-1 flex-col lg:mt-5">
            <h3 className="hidden text-lg font-black leading-tight md:text-xl lg:block">АвтоЦена — подбор автомобиля под ваш бюджет</h3>
            <p className="mt-0 text-sm font-medium leading-6 text-white/75 md:text-base md:leading-6 lg:mt-4">Сервис помогает быстро понять, какой автомобиль можно привезти под ключ. Задайте параметры, система покажет варианты и актуальный расчёт.</p>
            <p className="mt-5 hidden text-sm font-black leading-6 text-white md:text-base md:leading-6 lg:block">Следующий шаг — менеджер TopAvto проверит автомобиль, подтвердит наличие и подготовит точный расчёт.</p>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-3 lg:hidden"><div className="ac-budget-mobile min-w-0"><MobileBudgetPicker value={budget} options={budgets} onChange={setBudget} /></div><button type="button" onClick={submit} className="avto-button h-14 min-w-0 rounded-2xl px-3 text-sm font-black">Узнать Цену Авто</button></div><div className="mt-auto hidden items-end gap-4 pt-5 lg:flex"><button type="button" onClick={submit} className="avto-button h-[58px] min-w-0 flex-1 rounded-2xl px-4 text-sm font-black md:text-base">Узнать Цену Авто</button><img src="/brands/topavto-logo.png" alt="TopAvto" className="mb-1 h-auto w-[108px] shrink-0 object-contain" /></div>
          </div>
        </div>
      </section>
      <div className="-mt-2 lg:mt-0"><BuyerGallery images={buyers} /></div>
      <div className="mt-4 hidden gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-stretch">
        <section className="grid min-h-[206px] grid-cols-2 gap-4" aria-label="Финансовые сервисы">
          <a href={AUTOCREDIT_AFFILIATE_URL} target="_blank" rel={AFFILIATE_LINK_REL} aria-label="Подобрать автокредит в ВТБ" className="ac-executor-block relative block min-h-[206px] overflow-hidden rounded-[1.6rem] px-6 py-6 transition-[filter,transform] hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#35c932] active:scale-[.995]">
            <div className="relative z-10 h-full min-h-[158px] pr-[205px]">
              <div className="flex items-start gap-7">
                <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center text-[#35c932]" aria-hidden="true"><svg width="44" height="44" viewBox="0 0 48 48" fill="none"><rect x="7" y="5" width="34" height="38" rx="4" stroke="currentColor" strokeWidth="3.5"/><path d="M14 13h20M15 23h6M18 20v6M28 20l6 6M34 20l-6 6M15 34h6M28 34h6" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/></svg></div>
                <h3 className="min-w-0 pt-0.5 text-[23px] font-black leading-[1.08] text-[var(--ac-text)]">Кредитный<br />калькулятор</h3>
              </div>
              <p className="mt-8 max-w-[350px] text-[15px] font-medium leading-[1.45] text-[var(--ac-muted)]">Рассчитайте платёж и подберите<br className="hidden xl:block" /> удобные условия покупки автомобиля.</p>
            </div>
            <img src="/home/credit-mascot.webp" alt="" className="pointer-events-none absolute bottom-[-2px] right-3 h-[194px] w-[194px] object-contain object-bottom xl:right-4 xl:h-[202px] xl:w-[202px]" aria-hidden="true" />
          </a>
          <a href={OSAGO_AFFILIATE_URL} target="_blank" rel={AFFILIATE_LINK_REL} aria-label="Рассчитать полис ОСАГО на Банки.ру" className="ac-executor-block relative block min-h-[206px] overflow-hidden rounded-[1.6rem] px-6 py-6 transition-[filter,transform] hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffd21f] active:scale-[.995]">
            <div className="relative z-10 h-full min-h-[158px] pr-[215px]">
              <div className="flex items-start gap-7">
                <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center text-[#ffd21f]" aria-hidden="true"><svg width="44" height="44" viewBox="0 0 48 48" fill="none"><path d="M24 5 38 10v10.5c0 9-5.7 16.4-14 20.5-8.3-4.1-14-11.5-14-20.5V10l14-5Z" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round"/><path d="m17 23 5 5 10-10" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
                <h3 className="min-w-0 pt-0.5 text-[23px] font-black leading-[1.08] text-[var(--ac-text)]">Страховой полис<br />ОСАГО</h3>
              </div>
              <p className="mt-8 max-w-[350px] text-[15px] font-medium leading-[1.45] text-[var(--ac-muted)]">Быстрый расчёт стоимости полиса<br className="hidden xl:block" /> для выбранного автомобиля.</p>
            </div>
            <img src="/home/osago-mascot.webp" alt="" className="pointer-events-none absolute bottom-[-3px] right-1 h-[202px] w-[202px] object-contain object-bottom xl:right-2 xl:h-[210px] xl:w-[210px]" aria-hidden="true" />
          </a>
        </section>
        <CurrencyRatesStrip rates={rates} variant="desktop" className="hidden lg:block" />
      </div>
      <section className="mt-8"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="text-xs font-black uppercase tracking-[0.18em] text-red-400"><span className="lg:hidden">Автомобили в каталоге</span><span className="hidden lg:inline">Свежие предложения</span></div><h2 className="mt-2 text-3xl font-black md:text-5xl"><span className="lg:hidden">Свежие предложения</span><span className="hidden lg:inline">Автомобили в каталоге</span></h2></div></div>
        <CurrencyRatesStrip rates={rates} variant="mobile" className="mt-4 lg:hidden" />
        {catalogStatus === "loading" ? <CatalogLoadingSkeleton /> : catalogStatus === "error" && !items.length ? <div className="mt-6 rounded-2xl bg-white/[0.045] p-6">Не удалось загрузить каталог. Обновите страницу через минуту.</div> : marketGroups.length ? <div className="mt-7 space-y-8">{marketGroups.map((group) => { const params = new URLSearchParams({ market: group.id }); if (catalogMake) params.set("make", catalogMake); if (electricOnly) params.set("fuel", "electric"); return <section key={group.id}><div className="mb-4 flex items-end justify-between gap-3"><h3 className="flex min-w-0 items-center gap-2 text-[25px] font-black leading-none md:text-4xl"><CatalogMarketFlag market={group.id} className="h-5 w-7 md:h-6 md:w-9" /><span>{CATALOG_MARKET_LABELS[group.id]}</span><span className="text-sm font-black text-[var(--ac-muted)] md:text-base">· {electricOnly ? group.total : marketCounts[group.id] || group.total}</span></h3><Link href={`/cars?${params}`} className="ac-market-all-link shrink-0 text-sm font-black md:text-base">Все →</Link></div><div className="ac-home-market-rail -mr-4 grid grid-flow-col auto-cols-[47%] gap-2.5 overflow-x-auto pr-4 [scrollbar-width:none] md:mr-0 md:grid-flow-row md:grid-cols-4 md:overflow-visible md:pr-0">{group.items.map((item, index) => <div key={item.id} className={index >= 4 ? "md:hidden" : ""}><CatalogCard offer={item.raw} dense /></div>)}</div></section>; })}</div> : <div className="mt-6 rounded-2xl bg-white/[0.045] p-6">{electricOnly ? "Электромобили по выбранным параметрам пока не найдены." : "Каталог обновляется."}</div>}
        <BrandLogoRail brands={electricOnly ? availableItems.map((item) => item.make) : knowledgeMakes.length ? knowledgeMakes : availableItems.map((item) => item.make)} />
      </section>
    </div>
    {budgetInfoOpen ? <div className="fixed inset-0 z-[15020] flex items-end justify-center bg-black/65 backdrop-blur-md lg:hidden" onClick={() => setBudgetInfoOpen(false)}><section className="w-full rounded-t-[28px] bg-[var(--ac-surface)] p-5 pb-[calc(24px+env(safe-area-inset-bottom))] text-[var(--ac-text)]" onClick={(event) => event.stopPropagation()}><div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[var(--ac-muted)]/35" /><div className="flex items-start justify-between gap-4"><div><div className="text-xs font-black uppercase tracking-[.16em] text-red-500">Бюджет</div><h2 className="mt-1 text-2xl font-black">Как работает подбор?</h2></div><button type="button" onClick={() => setBudgetInfoOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ac-surface-2)] text-2xl">×</button></div><div className="mt-4 space-y-3 text-base font-medium leading-7 text-[var(--ac-muted)]"><p>АвтоЦена помогает быстро понять, какой автомобиль можно привезти под ваш бюджет. Укажите Ваш город и бюджет — система покажет подходящие варианты и актуальный расчёт.</p><p>После выбора менеджер TopAvto проверит автомобиль, подтвердит наличие и подготовит точный расчёт.</p></div><img src="/key-logo.png" alt="" className="mx-auto mt-5 max-h-44 w-full max-w-[270px] object-contain" /></section></div> : null}
    <style dangerouslySetInnerHTML={{ __html: `.ac-budget-picker-overlay{background:color-mix(in srgb,var(--ac-surface) 92%,transparent);border:1px solid color-mix(in srgb,var(--ac-text) 10%,transparent)}.ac-budget-picker-overlay .ac-filter-option{background:var(--ac-surface-2)!important;border:1px solid color-mix(in srgb,var(--ac-text) 10%,transparent)!important;color:var(--ac-text)!important}.ac-budget-picker-overlay .ac-filter-option.is-active{background:#ff353d!important;border-color:#ff353d!important;color:#fff!important}@media(max-width:1023px){.ac-home-page .ac-budget-mobile,.ac-home-page .ac-budget-mobile>div,.ac-home-page .ac-budget-mobile .ac-filter-control{width:100%!important;max-width:none!important;min-width:0!important}.ac-home-filter-drawer{padding:20px!important}.ac-home-filter-drawer__header{margin:0 0 26px!important}.ac-home-filter-drawer__fields{display:flex!important;flex-direction:column!important;gap:14px!important}.ac-home-filter-drawer__actions{margin-top:20px!important}}@media(max-width:767px){.ac-home-page .ac-catalog-card,.ac-home-page .ac-catalog-card *,.ac-home-page .ac-home-market-rail,.ac-home-page .ac-home-market-rail>*{box-shadow:none!important}}` }} />
  </main>;
}
