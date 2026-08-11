"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { VehicleModelSearch } from "@/components/catalog/VehicleModelSearch";
import { catalogFilterOptions } from "@/lib/catalog/filter-options";
import { CATALOG_MARKET_LABELS, PUBLIC_CATALOG_MARKETS } from "@/lib/catalog/runtime-config";

type Option = { value: string; label: string };
type Facets = { makes: string[]; models: Array<{ make: string; model: string; aliases?: string[] }>; markets?: string[]; bodyTypes?: string[]; fuels?: string[]; transmissions?: string[]; drives?: string[] };
type SortKey = "" | "totalRub" | "year";
type SortDir = "asc" | "desc";
type FilterDraft = {
  make: string;
  model: string;
  market: string;
  bodyType: string;
  transmission: string;
  yearFrom: string;
  yearTo: string;
  budgetFrom: string;
  budget: string;
  mileageFrom: string;
  mileageTo: string;
  engineFrom: string;
  engineTo: string;
  fuel: string;
  drive: string;
  powerTo: string;
};
type FilterChip = { key: string; label: string };

function clean(value: string) { return String(value || "").replace(/\s+/g, " ").trim(); }
function label(value: string) { return clean(value).replace(/\[object Object\]/gi, "") || "Без названия"; }
function Chevron({ open = false }: { open?: boolean }) { return <svg className={`shrink-0 transition ${open ? "rotate-180" : ""}`} width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function SlidersIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7H20M4 17H20M8 4V10M16 14V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="8" cy="7" r="2" fill="currentColor" /><circle cx="16" cy="17" r="2" fill="currentColor" /></svg>; }
function SortDirectionIcon({ direction }: { direction: SortDir }) { return <svg className={`transition-transform ${direction === "desc" ? "rotate-180" : ""}`} width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 3V16M6 3L3.5 5.5M6 3L8.5 5.5M14 17V4M14 17L11.5 14.5M14 17L16.5 14.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

function useDropdown(open: boolean, root: React.RefObject<HTMLDivElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [open, root, close]);
}

function SearchSelect({ name, value, options, placeholder, searchPlaceholder, onChange, className = "" }: { name: string; value: string; options: Option[]; placeholder: string; searchPlaceholder: string; onChange: (value: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); setQuery(""); };
  useDropdown(open, root, close);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return normalized ? options.filter((item) => item.label.toLocaleLowerCase("ru-RU").includes(normalized)) : options;
  }, [options, query]);
  const active = options.find((item) => item.value === value);
  const choose = (next: string) => { onChange(next); close(); };
  return <div ref={root} className={`relative min-w-0 ${open ? "z-[230]" : "z-0"} ${className}`}>
    <input type="hidden" name={name} value={value} />
    <button type="button" onClick={() => setOpen((current) => !current)} className="ac-filter-control flex h-13 w-full items-center justify-between gap-2 rounded-[15px] px-4 text-left text-sm font-black" aria-expanded={open}><span className="truncate">{active?.label || placeholder}</span><Chevron open={open} /></button>
    {open ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2"><div className="mb-1.5"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} autoFocus={false} className="ac-filter-search h-10 w-full rounded-xl px-3 text-sm font-bold outline-none" /></div><div className="ac-hide-scrollbar max-h-64 overflow-y-auto">{filtered.length ? filtered.map((item) => <button key={item.value || "any"} type="button" onClick={() => choose(item.value)} className={`ac-filter-option flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${value === item.value ? "is-active" : ""}`}><span>{item.label}</span>{value === item.value ? <span>✓</span> : null}</button>) : <div className="px-3 py-5 text-center text-sm font-bold text-[var(--ac-muted)]">Ничего не найдено</div>}</div></div> : null}
  </div>;
}

function SimpleSelect({ name, value, options, placeholder, onChange, className = "" }: { name: string; value: string; options: Option[]; placeholder: string; onChange: (value: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDropdown(open, root, close);
  const active = options.find((item) => item.value === value);
  return <div ref={root} className={`relative min-w-0 ${open ? "z-[220]" : "z-0"} ${className}`}>
    <input type="hidden" name={name} value={value} />
    <button type="button" onClick={() => setOpen((current) => !current)} className="ac-filter-control flex h-13 w-full items-center justify-between gap-2 rounded-[15px] px-4 text-left text-sm font-black" aria-expanded={open}><span className="truncate">{active?.label || placeholder}</span><Chevron open={open} /></button>
    {open ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2"><div className="ac-hide-scrollbar max-h-64 overflow-y-auto">{options.map((item) => <button key={item.value || "any"} type="button" onClick={() => { onChange(item.value); close(); }} className={`ac-filter-option flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${value === item.value ? "is-active" : ""}`}><span>{item.label}</span>{value === item.value ? <span>✓</span> : null}</button>)}</div></div> : null}
  </div>;
}

const markets: Option[] = [{ value: "", label: "Все рынки" }, ...PUBLIC_CATALOG_MARKETS.map((value) => ({ value, label: CATALOG_MARKET_LABELS[value] }))];
const bodies: Option[] = [{ value: "", label: "Любой кузов" }, { value: "suv", label: "Кроссовер" }, { value: "offroad", label: "Внедорожник" }, { value: "sedan", label: "Седан" }, { value: "hatchback", label: "Хэтчбек" }, { value: "wagon", label: "Универсал" }, { value: "minivan", label: "Минивэн" }, { value: "coupe", label: "Купе" }, { value: "convertible", label: "Кабриолет" }, { value: "pickup", label: "Пикап" }, { value: "van", label: "Фургон" }];
const fuels: Option[] = [{ value: "", label: "Любое топливо" }, { value: "petrol", label: "Бензин" }, { value: "diesel", label: "Дизель" }, { value: "hybrid", label: "Гибрид" }, { value: "electric", label: "Электро" }, { value: "lpg", label: "Газ" }];
const transmissions: Option[] = [{ value: "", label: "Любая трансмиссия" }, { value: "automatic", label: "Автомат" }, { value: "manual", label: "Механика" }, { value: "cvt", label: "Вариатор" }, { value: "dct", label: "Робот" }];
const drives: Option[] = [{ value: "", label: "Любой привод" }, { value: "fwd", label: "Передний" }, { value: "rwd", label: "Задний" }, { value: "awd", label: "Полный" }];

function optionLabel(options: Option[], value: string) { return options.find((option) => option.value === value)?.label || label(value); }
function formatNumber(value: number) { return new Intl.NumberFormat("ru-RU").format(Math.round(value)); }
function draftFromInitial(initial: Record<string, string>): FilterDraft {
  return {
    make: initial.make || "", model: initial.model || "", market: initial.market || "", bodyType: initial.bodyType || "", transmission: initial.transmission || "",
    yearFrom: initial.yearFrom || "", yearTo: initial.yearTo || "", budgetFrom: initial.budgetFrom || "", budget: initial.budget || initial.budgetTo || "",
    mileageFrom: initial.mileageFrom || "", mileageTo: initial.mileageTo || "", engineFrom: initial.engineFrom || "", engineTo: initial.engineTo || "",
    fuel: initial.fuel || "", drive: initial.drive || "", powerTo: initial.powerTo || "",
  };
}
function initialSort(sort: string): { key: SortKey; direction: SortDir } {
  if (sort === "totalRubDesc") return { key: "totalRub", direction: "desc" };
  if (sort === "totalRub") return { key: "totalRub", direction: "asc" };
  if (sort === "yearAsc") return { key: "year", direction: "asc" };
  if (sort === "year") return { key: "year", direction: "desc" };
  return { key: "", direction: "asc" };
}
function sortParam(key: SortKey, direction: SortDir) {
  if (key === "totalRub") return direction === "desc" ? "totalRubDesc" : "totalRub";
  if (key === "year") return direction === "asc" ? "yearAsc" : "year";
  return "";
}

async function loadElectricFacets() {
  const response = await fetch("/api/catalog/search?fuel=electric&pageSize=1&includeFacets=1", { cache: "no-store" });
  if (!response.ok) throw new Error(`catalog_electric_facets_http_${response.status}`);
  const payload = await response.json();
  if (!payload?.facets) throw new Error("catalog_electric_facets_missing");
  return payload.facets as Facets;
}

function ElectricCheckbox({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="ac-filter-control ac-electric-filter flex min-h-13 cursor-pointer items-center gap-2 rounded-[15px] px-4 text-sm font-black"><input type="checkbox" name="fuel" value="electric" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" /><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sm transition" style={{ background: checked ? "#ffd21f" : "var(--ac-surface-3)", border: checked ? "1px solid #ffd21f" : "1px solid rgba(103,113,130,.55)", color: checked ? "#171a21" : "transparent" }}>✓</span><span className="text-[17px] leading-none text-[#ffd21f]" aria-hidden="true">⚡</span><span>Электро</span></label>;
}

function PowerLimitCheckbox({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!infoOpen) return; const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setInfoOpen(false); }; document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside); }, [infoOpen]);
  return <div ref={root} className={`relative ${infoOpen ? "z-[250]" : "z-0"}`}><label className="ac-filter-control ac-power-limit flex min-h-13 cursor-pointer items-center gap-3 rounded-[15px] px-4 pr-12 text-sm font-black"><input type="checkbox" name="powerTo" value="160" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" /><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-sm transition" style={{ background: checked ? "#ff353d" : "var(--ac-surface-3)", border: checked ? "1px solid #ff353d" : "1px solid rgba(103,113,130,.55)", color: checked ? "#ffffff" : "transparent" }}>✓</span><span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"><span>До 160 л.с.</span><span className="text-[10px] font-black text-red-500">свыше — полный утильсбор</span></span></label><button type="button" onClick={() => setInfoOpen((current) => !current)} className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-sm font-black" style={{ background: "var(--ac-surface-3)", border: "1px solid rgba(103,113,130,.45)" }} aria-label="Почему есть фильтр до 160 лошадиных сил" aria-expanded={infoOpen}>?</button>{infoOpen ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+8px)] rounded-2xl p-4 text-sm font-bold leading-6"><div className="font-black">Почему до 160 л.с.?</div><p className="mt-2 text-[var(--ac-muted)]">Мощность влияет на коэффициент утилизационного сбора. Для электромобилей и гибридов применяется расчётная мощность по документам.</p><p className="mt-2 font-black text-red-500">Свыше 160 л.с. итоговые платежи могут быть значительно выше.</p></div> : null}</div>;
}

function SortControl({ sortKey, direction, onKeyChange, onDirectionChange, mobile = false }: { sortKey: SortKey; direction: SortDir; onKeyChange: (key: SortKey) => void; onDirectionChange: (direction: SortDir) => void; mobile?: boolean }) {
  const caption = sortKey === "totalRub" ? (direction === "asc" ? "сначала дешевле" : "сначала дороже") : sortKey === "year" ? (direction === "desc" ? "сначала новые" : "сначала старше") : "актуальные сначала";
  return <div className="min-w-0">
    <input type="hidden" name="sort" value={sortParam(sortKey, direction)} />
    <div className="ac-sort-control grid min-h-13 grid-cols-[1.08fr_.72fr_.72fr_48px] overflow-hidden rounded-[15px]">
      <button type="button" onClick={() => onKeyChange("")} className={`min-w-0 px-2 text-xs font-black ${sortKey === "" ? "is-active" : ""}`}><span className="hidden 2xl:inline">По умолчанию</span><span className="2xl:hidden">По умолч.</span></button>
      <button type="button" onClick={() => onKeyChange("totalRub")} className={`min-w-0 px-2 text-xs font-black ${sortKey === "totalRub" ? "is-active" : ""}`}>Цена</button>
      <button type="button" onClick={() => onKeyChange("year")} className={`min-w-0 px-2 text-xs font-black ${sortKey === "year" ? "is-active" : ""}`}>Год</button>
      <button type="button" disabled={!sortKey} onClick={() => onDirectionChange(direction === "asc" ? "desc" : "asc")} className="ac-sort-direction flex items-center justify-center" aria-label={sortKey ? `Изменить порядок: ${caption}` : "Выберите сортировку по цене или году"} title={caption}><SortDirectionIcon direction={direction} /></button>
    </div>
    {mobile ? <div className="mt-1.5 px-1 text-[11px] font-bold text-[var(--ac-muted)]">{caption}</div> : null}
  </div>;
}

function DualRange({ title, fromName, toName, fromValue, toValue, min, max, step, unit = "", format = formatNumber, onChange }: { title: string; fromName: string; toName: string; fromValue: string; toValue: string; min: number; max: number; step: number; unit?: string; format?: (value: number) => string; onChange: (from: string, to: string) => void }) {
  const parsedFrom = Number(fromValue);
  const parsedTo = Number(toValue);
  const low = Number.isFinite(parsedFrom) && parsedFrom > 0 ? Math.min(max, Math.max(min, parsedFrom)) : min;
  const high = Number.isFinite(parsedTo) && parsedTo > 0 ? Math.min(max, Math.max(low, parsedTo)) : max;
  const span = Math.max(1, max - min);
  const left = ((low - min) / span) * 100;
  const right = 100 - ((high - min) / span) * 100;
  const clear = () => onChange("", "");
  const formatValue = (value: number) => `${format(value)}${unit}`;
  return <div className="ac-range-card rounded-[17px] p-3.5">
    <div className="flex items-center justify-between gap-3"><span className="text-xs font-black uppercase tracking-[.08em] text-[var(--ac-muted)]">{title}</span>{fromValue || toValue ? <button type="button" onClick={clear} className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-black text-[var(--ac-muted)]" aria-label={`Сбросить ${title}`}>×</button> : null}</div>
    <div className="mt-1.5 flex items-center justify-between gap-3 text-sm font-black"><span>{fromValue ? `от ${formatValue(low)}` : "без минимума"}</span><span>{toValue ? `до ${formatValue(high)}` : "без максимума"}</span></div>
    <div className="ac-dual-range mt-3">
      <div className="ac-dual-range__track"><span style={{ left: `${left}%`, right: `${right}%` }} /></div>
      <input type="range" min={min} max={max} step={step} value={low} onChange={(event) => { const next = Math.min(Number(event.target.value), high); onChange(next <= min ? "" : String(next), toValue); }} className="ac-range-slider ac-range-slider--min" aria-label={`${title}: минимум`} />
      <input type="range" min={min} max={max} step={step} value={high} onChange={(event) => { const next = Math.max(Number(event.target.value), low); onChange(fromValue, next >= max ? "" : String(next)); }} className="ac-range-slider ac-range-slider--max" aria-label={`${title}: максимум`} />
    </div>
    <input type="hidden" name={fromName} value={fromValue} /><input type="hidden" name={toName} value={toValue} />
  </div>;
}

function FilterChips({ chips, onRemove, compact = false }: { chips: FilterChip[]; onRemove: (key: string) => void; compact?: boolean }) {
  if (!chips.length) return null;
  return <div className={`flex min-w-0 flex-wrap items-center gap-2 ${compact ? "" : "mt-3"}`} aria-label="Выбранные параметры">{!compact ? <span className="mr-1 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--ac-muted)]">Выбрано</span> : null}{chips.map((item) => <button key={item.key} type="button" onClick={() => onRemove(item.key)} className="ac-filter-chip flex min-h-8 max-w-full items-center gap-1.5 rounded-full px-3 text-xs font-black"><span className="truncate">{item.label}</span><span className="text-base leading-none opacity-55">×</span></button>)}</div>;
}

function AdvancedFields({ draft, setField, makeOptions, marketOptions, bodyOptions, transmissionOptions, fuelOptions, driveOptions, includePrimary = false, includeFuel = true }: { draft: FilterDraft; setField: (key: keyof FilterDraft, value: string) => void; makeOptions: Option[]; marketOptions: Option[]; bodyOptions: Option[]; transmissionOptions: Option[]; fuelOptions: Option[]; driveOptions: Option[]; includePrimary?: boolean; includeFuel?: boolean }) {
  return <>
    {includePrimary ? <div className="grid gap-2.5 md:grid-cols-3"><SearchSelect name="make" value={draft.make} placeholder="Любая марка" searchPlaceholder="Найти марку" options={makeOptions} onChange={(value) => { setField("make", value); setField("model", ""); }} /><VehicleModelSearch value={draft.model} make={draft.make} onMakeChange={(value) => setField("make", value)} onValueChange={(value) => setField("model", value)} /><SimpleSelect name="market" value={draft.market} placeholder="Все рынки" options={marketOptions} onChange={(value) => setField("market", value)} /></div> : null}
    <div className={`grid gap-2.5 md:grid-cols-2 lg:grid-cols-4 ${includePrimary ? "mt-2.5" : ""}`}>{bodyOptions.length > 1 ? <SimpleSelect name="bodyType" value={draft.bodyType} placeholder="Любой кузов" options={bodyOptions} onChange={(value) => setField("bodyType", value)} /> : null}{transmissionOptions.length > 1 ? <SimpleSelect name="transmission" value={draft.transmission} placeholder="Любая трансмиссия" options={transmissionOptions} onChange={(value) => setField("transmission", value)} /> : null}{includeFuel && fuelOptions.length > 1 ? <SimpleSelect name="fuel" value={draft.fuel === "electric" ? "" : draft.fuel} placeholder="Любое топливо" options={fuelOptions.filter((item) => item.value !== "electric")} onChange={(value) => setField("fuel", value)} /> : null}{driveOptions.length > 1 ? <SimpleSelect name="drive" value={draft.drive} placeholder="Любой привод" options={driveOptions} onChange={(value) => setField("drive", value)} /> : null}</div>
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <DualRange title="Год" fromName="yearFrom" toName="yearTo" fromValue={draft.yearFrom} toValue={draft.yearTo} min={1990} max={new Date().getFullYear()} step={1} format={(value) => String(Math.round(value))} onChange={(from, to) => { setField("yearFrom", from); setField("yearTo", to); }} />
      <DualRange title="Цена" fromName="budgetFrom" toName="budget" fromValue={draft.budgetFrom} toValue={draft.budget} min={0} max={30_000_000} step={100_000} unit=" ₽" onChange={(from, to) => { setField("budgetFrom", from); setField("budget", to); }} />
      <DualRange title="Пробег" fromName="mileageFrom" toName="mileageTo" fromValue={draft.mileageFrom} toValue={draft.mileageTo} min={0} max={500_000} step={5_000} unit=" км" onChange={(from, to) => { setField("mileageFrom", from); setField("mileageTo", to); }} />
      <DualRange title="Объём двигателя" fromName="engineFrom" toName="engineTo" fromValue={draft.engineFrom} toValue={draft.engineTo} min={0} max={8_000} step={100} unit=" см³" onChange={(from, to) => { setField("engineFrom", from); setField("engineTo", to); }} />
    </div>
  </>;
}

function FilterActions({ mobile = false }: { mobile?: boolean }) {
  return <div className={`flex items-center gap-2.5 ${mobile ? "" : ""}`}><Link href="/cars" className={`ac-filter-reset flex h-13 items-center justify-center rounded-[15px] px-4 text-sm font-black ${mobile ? "flex-1" : ""}`}>Сбросить</Link><button type="submit" className={`avto-button flex h-13 items-center justify-center rounded-[15px] px-5 text-sm font-black ${mobile ? "flex-[1.8]" : "min-w-[150px]"}`}>Показать автомобили</button></div>;
}

export function CatalogFilters({ initial, facets }: { initial: Record<string, string>; facets?: Facets }) {
  const formKey = useMemo(() => JSON.stringify(initial), [initial]);
  const [draft, setDraft] = useState<FilterDraft>(() => draftFromInitial(initial));
  const initialSortState = useMemo(() => initialSort(initial.sort || ""), [initial.sort]);
  const [sortKey, setSortKey] = useState<SortKey>(initialSortState.key);
  const [sortDirection, setSortDirection] = useState<SortDir>(initialSortState.direction);
  const [electricFacets, setElectricFacets] = useState<Facets | null>(null);
  const hasAdvancedValue = Boolean(initial.advanced === "1" || initial.bodyType || initial.transmission || initial.yearFrom || initial.yearTo || initial.budgetFrom || initial.budget || initial.budgetTo || initial.mileageFrom || initial.mileageTo || initial.engineFrom || initial.engineTo || (initial.fuel && initial.fuel !== "electric") || initial.drive);
  const [expanded, setExpanded] = useState(hasAdvancedValue);
  const [mobileOpen, setMobileOpen] = useState(false);
  const electricOnly = draft.fuel === "electric";

  useEffect(() => {
    setDraft(draftFromInitial(initial));
    const nextSort = initialSort(initial.sort || "");
    setSortKey(nextSort.key);
    setSortDirection(nextSort.direction);
  }, [formKey]);

  useEffect(() => {
    if (!electricOnly) { setElectricFacets(null); return; }
    let cancelled = false;
    loadElectricFacets().then((next) => { if (!cancelled) setElectricFacets(next); }).catch(() => { if (!cancelled) setElectricFacets({ makes: [], models: [], markets: [], bodyTypes: [], fuels: ["electric"], transmissions: [], drives: [] }); });
    return () => { cancelled = true; };
  }, [electricOnly]);

  useEffect(() => {
    if (!mobileOpen) return;
    const old = document.body.style.overflow;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = old; window.removeEventListener("keydown", escape); };
  }, [mobileOpen]);

  const activeFacets = electricOnly ? electricFacets || facets : facets;
  const makeOptions = useMemo<Option[]>(() => [{ value: "", label: "Любая марка" }, ...[...new Set<string>([...(activeFacets?.makes || []), draft.make].map(clean).filter(Boolean))].sort((a, b) => label(a).localeCompare(label(b), "ru")).map((value) => ({ value, label: label(value) }))], [activeFacets, draft.make]);
  const marketOptions = markets;
  const bodyOptions = useMemo(() => catalogFilterOptions(bodies, activeFacets?.bodyTypes, draft.bodyType), [activeFacets, draft.bodyType]);
  const fuelOptions = useMemo(() => catalogFilterOptions(fuels, activeFacets?.fuels, draft.fuel), [activeFacets, draft.fuel]);
  const transmissionOptions = useMemo(() => catalogFilterOptions(transmissions, activeFacets?.transmissions, draft.transmission), [activeFacets, draft.transmission]);
  const driveOptions = useMemo(() => catalogFilterOptions(drives, activeFacets?.drives, draft.drive), [activeFacets, draft.drive]);

  const setField = (key: keyof FilterDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  useEffect(() => { if (draft.make && !makeOptions.some((option) => option.value === draft.make)) setField("make", ""); }, [draft.make, makeOptions]);

  const chips = useMemo<FilterChip[]>(() => {
    const rows: FilterChip[] = [];
    if (draft.make) rows.push({ key: "make", label: draft.make });
    if (draft.model) rows.push({ key: "model", label: draft.model });
    if (draft.market) rows.push({ key: "market", label: optionLabel(markets, draft.market) });
    if (draft.bodyType) rows.push({ key: "bodyType", label: optionLabel(bodies, draft.bodyType) });
    if (draft.transmission) rows.push({ key: "transmission", label: optionLabel(transmissions, draft.transmission) });
    if (draft.fuel) rows.push({ key: "fuel", label: optionLabel(fuels, draft.fuel) });
    if (draft.drive) rows.push({ key: "drive", label: optionLabel(drives, draft.drive) });
    if (draft.powerTo === "160") rows.push({ key: "powerTo", label: "До 160 л.с." });
    if (draft.yearFrom || draft.yearTo) rows.push({ key: "year", label: `Год ${draft.yearFrom ? `от ${draft.yearFrom}` : ""}${draft.yearFrom && draft.yearTo ? " · " : ""}${draft.yearTo ? `до ${draft.yearTo}` : ""}`.trim() });
    if (draft.budgetFrom || draft.budget) rows.push({ key: "budget", label: `Цена ${draft.budgetFrom ? `от ${formatNumber(Number(draft.budgetFrom))} ₽` : ""}${draft.budgetFrom && draft.budget ? " · " : ""}${draft.budget ? `до ${formatNumber(Number(draft.budget))} ₽` : ""}`.trim() });
    if (draft.mileageFrom || draft.mileageTo) rows.push({ key: "mileage", label: `Пробег ${draft.mileageFrom ? `от ${formatNumber(Number(draft.mileageFrom))}` : ""}${draft.mileageFrom && draft.mileageTo ? " · " : ""}${draft.mileageTo ? `до ${formatNumber(Number(draft.mileageTo))} км` : ""}`.trim() });
    if (draft.engineFrom || draft.engineTo) rows.push({ key: "engine", label: `Объём ${draft.engineFrom ? `от ${formatNumber(Number(draft.engineFrom))}` : ""}${draft.engineFrom && draft.engineTo ? " · " : ""}${draft.engineTo ? `до ${formatNumber(Number(draft.engineTo))} см³` : ""}`.trim() });
    return rows;
  }, [draft]);

  const removeFilter = (key: string) => {
    if (key === "year") return setDraft((current) => ({ ...current, yearFrom: "", yearTo: "" }));
    if (key === "budget") return setDraft((current) => ({ ...current, budgetFrom: "", budget: "" }));
    if (key === "mileage") return setDraft((current) => ({ ...current, mileageFrom: "", mileageTo: "" }));
    if (key === "engine") return setDraft((current) => ({ ...current, engineFrom: "", engineTo: "" }));
    if (key in draft) setField(key as keyof FilterDraft, "");
  };
  const setElectric = (checked: boolean) => { setField("fuel", checked ? "electric" : ""); setElectricFacets(null); };
  const chooseSort = (key: SortKey) => {
    setSortKey(key);
    if (key === "totalRub") setSortDirection("asc");
    if (key === "year") setSortDirection("desc");
  };
  const advancedCount = chips.filter((item) => ["bodyType", "transmission", "fuel", "drive", "year", "budget", "mileage", "engine"].includes(item.key)).length;

  return <>
    <form key={`desktop-${formKey}`} method="get" className="ac-catalog-filter-panel ac-filter-panel mt-6 hidden rounded-[1.8rem] p-4 lg:block">
      <div className="grid grid-cols-3 gap-2.5">
        <SearchSelect name="make" value={draft.make} placeholder="Любая марка" searchPlaceholder="Найти марку" options={makeOptions} onChange={(value) => { setField("make", value); setField("model", ""); }} />
        <VehicleModelSearch value={draft.model} make={draft.make} onMakeChange={(value) => setField("make", value)} onValueChange={(value) => setField("model", value)} />
        <SimpleSelect name="market" value={draft.market} placeholder="Все рынки" options={marketOptions} onChange={(value) => setField("market", value)} />
      </div>
      <div className="mt-2.5 grid grid-cols-[minmax(0,1.25fr)_minmax(145px,.58fr)_minmax(310px,1.05fr)_auto_54px] items-center gap-2.5">
        <PowerLimitCheckbox checked={draft.powerTo === "160"} onChange={(checked) => setField("powerTo", checked ? "160" : "")} />
        <ElectricCheckbox checked={electricOnly} onChange={setElectric} />
        <SortControl sortKey={sortKey} direction={sortDirection} onKeyChange={chooseSort} onDirectionChange={setSortDirection} />
        <button type="submit" className="avto-button flex h-13 items-center justify-center rounded-[15px] px-5 text-sm font-black">Показать</button>
        <button type="button" onClick={() => setExpanded((current) => !current)} className={`ac-filter-settings relative flex h-13 w-[54px] items-center justify-center rounded-[15px] ${expanded ? "is-active" : ""}`} aria-label="Расширенные фильтры" aria-expanded={expanded}><SlidersIcon />{advancedCount ? <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">{advancedCount}</span> : null}</button>
      </div>
      {expanded ? <section className="ac-advanced-fields mt-3 rounded-[1.35rem] p-3.5"><AdvancedFields draft={draft} setField={setField} makeOptions={makeOptions} marketOptions={marketOptions} bodyOptions={bodyOptions} transmissionOptions={transmissionOptions} fuelOptions={fuelOptions} driveOptions={driveOptions} includeFuel={!electricOnly} /></section> : null}
      <FilterChips chips={chips} onRemove={removeFilter} />
    </form>

    <button type="button" onClick={() => setMobileOpen(true)} className="ac-filter-more-button mt-5 flex h-14 w-full items-center justify-between rounded-2xl px-4 text-sm font-black lg:hidden" aria-label="Открыть фильтры"><span className="flex items-center gap-2"><span>Фильтры</span>{chips.length ? <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] text-white">{chips.length}</span> : null}</span><SlidersIcon /></button>

    {mobileOpen ? <div className="ac-mobile-filter-backdrop fixed inset-0 z-[10040] flex items-end bg-black/65 backdrop-blur-md lg:hidden" onClick={() => setMobileOpen(false)}><form key={`mobile-${formKey}`} method="get" role="dialog" aria-modal="true" aria-label="Фильтры каталога" className="ac-mobile-filter-sheet flex w-full max-h-[91dvh] flex-col overflow-hidden rounded-t-[30px] bg-[var(--ac-surface)] text-[var(--ac-text)]" onClick={(event) => event.stopPropagation()}>
      <div className="shrink-0 px-4 pt-2"><div className="mx-auto h-1.5 w-12 rounded-full bg-[var(--ac-muted)]/35" /><div className="flex items-center justify-between gap-3 pb-3 pt-3"><div><div className="text-[10px] font-black uppercase tracking-[.15em] text-red-500">Каталог</div><h2 className="mt-0.5 text-2xl font-black">Фильтры</h2></div><button type="button" onClick={() => setMobileOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ac-surface-2)] text-2xl" aria-label="Закрыть">×</button></div></div>
      <div className="ac-hide-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {chips.length ? <section className="mb-4"><div className="mb-2 text-[10px] font-black uppercase tracking-[.14em] text-[var(--ac-muted)]">Выбрано</div><FilterChips chips={chips} onRemove={removeFilter} compact /></section> : null}
        <section className="ac-mobile-filter-section"><div className="ac-mobile-filter-section__title">Сортировка</div><SortControl sortKey={sortKey} direction={sortDirection} onKeyChange={chooseSort} onDirectionChange={setSortDirection} mobile /></section>
        <section className="ac-mobile-filter-section"><div className="ac-mobile-filter-section__title">Быстрые параметры</div><div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"><ElectricCheckbox checked={electricOnly} onChange={setElectric} /><PowerLimitCheckbox checked={draft.powerTo === "160"} onChange={(checked) => setField("powerTo", checked ? "160" : "")} /></div></section>
        <section className="ac-mobile-filter-section"><div className="ac-mobile-filter-section__title">Автомобиль</div><AdvancedFields draft={draft} setField={setField} makeOptions={makeOptions} marketOptions={marketOptions} bodyOptions={bodyOptions} transmissionOptions={transmissionOptions} fuelOptions={fuelOptions} driveOptions={driveOptions} includePrimary includeFuel={!electricOnly} /></section>
      </div>
      <div className="shrink-0 border-t border-white/5 bg-[var(--ac-surface)] px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3"><FilterActions mobile /></div>
    </form></div> : null}

    <style jsx global>{`
      .ac-sort-control,.ac-filter-settings,.ac-filter-reset,.ac-range-card,.ac-filter-chip{background:var(--ac-surface-2);color:var(--ac-text);border:1px solid var(--ac-border)}
      .ac-sort-control>button+button{border-left:1px solid var(--ac-border)}
      .ac-sort-control button{color:var(--ac-muted);transition:background-color .16s ease,color .16s ease}
      .ac-sort-control button.is-active{background:var(--ac-surface-3);color:var(--ac-text)}
      .ac-sort-direction:disabled{opacity:.35;cursor:not-allowed}
      .ac-filter-settings{transition:background-color .16s ease,color .16s ease,transform .16s ease}
      .ac-filter-settings:hover,.ac-filter-settings.is-active{background:var(--ac-surface-3);color:#ff353d}
      .ac-filter-settings:active{transform:scale(.96)}
      .ac-advanced-fields{background:var(--ac-surface-2)}
      .ac-range-card{background:var(--ac-surface)}
      .ac-filter-chip{background:var(--ac-surface-2)}
      .ac-filter-chip:hover{background:var(--ac-surface-3)}
      .ac-dual-range{position:relative;height:22px}
      .ac-dual-range__track{position:absolute;left:8px;right:8px;top:9px;height:4px;border-radius:999px;background:var(--ac-surface-3);overflow:hidden}
      .ac-dual-range__track span{position:absolute;top:0;bottom:0;border-radius:999px;background:#ff353d}
      .ac-range-slider{position:absolute;inset:0;width:100%;height:22px;margin:0;background:transparent!important;border:0!important;appearance:none;-webkit-appearance:none;pointer-events:none;outline:none!important;box-shadow:none!important}
      .ac-range-slider::-webkit-slider-runnable-track{height:4px;background:transparent}
      .ac-range-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:18px;height:18px;margin-top:-7px;border:3px solid var(--ac-surface);border-radius:999px;background:#ff353d;pointer-events:auto;cursor:pointer;box-shadow:0 0 0 1px rgba(255,53,61,.2)!important}
      .ac-range-slider::-moz-range-track{height:4px;background:transparent}
      .ac-range-slider::-moz-range-thumb{width:18px;height:18px;border:3px solid var(--ac-surface);border-radius:999px;background:#ff353d;pointer-events:auto;cursor:pointer;box-shadow:0 0 0 1px rgba(255,53,61,.2)!important}
      .ac-range-slider--min{z-index:2}.ac-range-slider--max{z-index:3}
      .ac-mobile-filter-section{margin-top:12px;padding:12px;border-radius:20px;background:var(--ac-surface-2)}
      .ac-mobile-filter-section__title{margin:0 0 9px;font-size:10px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:var(--ac-muted)}
      @media(max-width:1023px){
        .ac-mobile-filter-sheet .ac-filter-control,.ac-mobile-filter-sheet .ac-sort-control{min-height:52px;height:52px;border-radius:15px}
        .ac-mobile-filter-sheet .ac-filter-dropdown{position:static!important;inset:auto!important;margin-top:6px;background:var(--ac-surface-3);box-shadow:none!important;border:1px solid var(--ac-border)!important}
        .ac-mobile-filter-sheet .relative:has(>.ac-filter-dropdown){z-index:auto!important}
        .ac-mobile-filter-sheet .ac-filter-dropdown .ac-filter-option{background:transparent}
        .ac-mobile-filter-sheet .ac-filter-dropdown .ac-filter-option.is-active{background:rgba(255,53,61,.12);color:#ff5962}
        .ac-mobile-filter-sheet .ac-advanced-fields{background:transparent}
        .ac-mobile-filter-sheet .ac-range-card{background:var(--ac-surface)}
      }
      html[data-theme="light"] .ac-mobile-filter-sheet [class*="border-white/"]{border-color:rgba(30,36,48,.09)!important}
    `}</style>
  </>;
}
