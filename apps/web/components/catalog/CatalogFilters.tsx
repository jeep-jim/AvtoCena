"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { VehicleModelSearch } from "@/components/catalog/VehicleModelSearch";
import { catalogFilterOptions } from "@/lib/catalog/filter-options";
import { CATALOG_MARKET_LABELS, PUBLIC_CATALOG_MARKETS } from "@/lib/catalog/runtime-config";

type Option = { value: string; label: string };
type Facets = { makes: string[]; models: Array<{ make: string; model: string; aliases?: string[] }>; markets?: string[]; bodyTypes?: string[]; fuels?: string[]; transmissions?: string[]; drives?: string[] };

function clean(value: string) { return String(value || "").replace(/\s+/g, " ").trim(); }
function label(value: string) { return clean(value).replace(/\[object Object\]/gi, "") || "Без названия"; }
function Chevron({ open = false }: { open?: boolean }) { return <svg className={`shrink-0 transition ${open ? "rotate-180" : ""}`} width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function SlidersIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7H20M4 17H20M8 4V10M16 14V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="8" cy="7" r="2" fill="currentColor" /><circle cx="16" cy="17" r="2" fill="currentColor" /></svg>; }

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

function SearchSelect({ name, value, options, placeholder, searchPlaceholder, onChange, className = "" }: { name: string; value: string; options: Option[]; placeholder: string; searchPlaceholder: string; onChange?: (value: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(value);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); setQuery(""); };
  useDropdown(open, root, close);
  useEffect(() => setSelected(value), [value]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return normalized ? options.filter((item) => item.label.toLocaleLowerCase("ru-RU").includes(normalized)) : options;
  }, [options, query]);
  const active = options.find((item) => item.value === selected);
  const choose = (next: string) => { setSelected(next); onChange?.(next); close(); };
  return <div ref={root} className={`relative min-w-0 ${open ? "z-[230]" : "z-0"} ${className}`}>
    <input type="hidden" name={name} value={selected} />
    <button type="button" onClick={() => setOpen((current) => !current)} className="ac-filter-control flex h-14 w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-sm font-black" aria-expanded={open}><span className="truncate">{active?.label || placeholder}</span><Chevron open={open} /></button>
    {open ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2"><div className="mb-1.5"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} autoFocus={false} className="ac-filter-search h-10 w-full rounded-xl px-3 text-sm font-bold outline-none" /></div><div className="ac-hide-scrollbar max-h-64 overflow-y-auto">{filtered.length ? filtered.map((item) => <button key={item.value || "any"} type="button" onClick={() => choose(item.value)} className={`ac-filter-option flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${selected === item.value ? "is-active" : ""}`}><span>{item.label}</span>{selected === item.value ? <span>✓</span> : null}</button>) : <div className="px-3 py-5 text-center text-sm font-bold text-white/40">Ничего не найдено</div>}</div></div> : null}
  </div>;
}

function SimpleSelect({ name, value, options, placeholder, onChange, className = "" }: { name: string; value: string; options: Option[]; placeholder: string; onChange?: (value: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDropdown(open, root, close);
  useEffect(() => setSelected(value), [value]);
  const active = options.find((item) => item.value === selected);
  return <div ref={root} className={`relative min-w-0 ${open ? "z-[220]" : "z-0"} ${className}`}>
    <input type="hidden" name={name} value={selected} />
    <button type="button" onClick={() => setOpen((current) => !current)} className="ac-filter-control flex h-14 w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-sm font-black" aria-expanded={open}><span className="truncate">{active?.label || placeholder}</span><Chevron open={open} /></button>
    {open ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2"><div className="ac-hide-scrollbar max-h-64 overflow-y-auto">{options.map((item) => <button key={item.value || "any"} type="button" onClick={() => { setSelected(item.value); onChange?.(item.value); close(); }} className={`ac-filter-option flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${selected === item.value ? "is-active" : ""}`}><span>{item.label}</span>{selected === item.value ? <span>✓</span> : null}</button>)}</div></div> : null}
  </div>;
}

const markets: Option[] = [{ value: "", label: "Все рынки" }, ...PUBLIC_CATALOG_MARKETS.map((value) => ({ value, label: CATALOG_MARKET_LABELS[value] }))];
const sorts: Option[] = [
  { value: "", label: "Сортировка: по умолчанию" },
  { value: "totalRub", label: "Цена: сначала дешевле" },
  { value: "year", label: "Год: сначала новые" },
  { value: "mileage", label: "Пробег: сначала меньше" },
];
const bodies: Option[] = [{ value: "", label: "Любой кузов" }, { value: "suv", label: "Кроссовер" }, { value: "offroad", label: "Внедорожник" }, { value: "sedan", label: "Седан" }, { value: "hatchback", label: "Хэтчбек" }, { value: "wagon", label: "Универсал" }, { value: "minivan", label: "Минивэн" }, { value: "coupe", label: "Купе" }, { value: "convertible", label: "Кабриолет" }, { value: "pickup", label: "Пикап" }, { value: "van", label: "Фургон" }];
const fuels: Option[] = [{ value: "", label: "Любое топливо" }, { value: "petrol", label: "Бензин" }, { value: "diesel", label: "Дизель" }, { value: "hybrid", label: "Гибрид" }, { value: "electric", label: "Электро" }, { value: "lpg", label: "Газ" }];
const transmissions: Option[] = [{ value: "", label: "Любая трансмиссия" }, { value: "automatic", label: "Автомат" }, { value: "manual", label: "Механика" }, { value: "cvt", label: "Вариатор" }, { value: "dct", label: "Робот" }];
const drives: Option[] = [{ value: "", label: "Любой привод" }, { value: "fwd", label: "Передний" }, { value: "rwd", label: "Задний" }, { value: "awd", label: "Полный" }];

function optionLabel(options: Option[], value: string) {
  return options.find((option) => option.value === value)?.label || label(value);
}

function filterSummary(initial: Record<string, string>) {
  const rows: string[] = [];
  const range = (title: string, from?: string, to?: string, suffix = "") => {
    if (from && to) rows.push(`${title}: ${from}–${to}${suffix}`);
    else if (from) rows.push(`${title}: от ${from}${suffix}`);
    else if (to) rows.push(`${title}: до ${to}${suffix}`);
  };
  if (initial.market) rows.push(optionLabel(markets, initial.market));
  if (initial.make) rows.push(initial.make);
  if (initial.model) rows.push(initial.model);
  if (initial.bodyType) rows.push(optionLabel(bodies, initial.bodyType));
  if (initial.fuel) rows.push(optionLabel(fuels, initial.fuel));
  if (initial.transmission) rows.push(optionLabel(transmissions, initial.transmission));
  if (initial.drive) rows.push(optionLabel(drives, initial.drive));
  range("Год", initial.yearFrom, initial.yearTo);
  range("Цена", initial.budgetFrom, initial.budget || initial.budgetTo, " ₽");
  range("Пробег", initial.mileageFrom, initial.mileageTo, " км");
  range("Объём", initial.engineFrom, initial.engineTo, " см³");
  range("Мощность", initial.powerFrom, initial.powerTo, " л.с.");
  return [...new Set(rows.filter(Boolean))];
}

function FilterActions({ mobile = false }: { mobile?: boolean }) {
  return <div className={`flex items-center gap-3 ${mobile ? "sticky bottom-0 z-10 -mx-1 mt-2 bg-[var(--ac-surface)]/95 px-1 pb-1 pt-3 backdrop-blur-xl" : "mt-4 justify-end"}`}>
    <Link href="/cars" className="flex h-12 items-center justify-center rounded-2xl bg-white/[0.055] px-5 text-sm font-black">Сбросить</Link>
    <button type="submit" className="avto-button flex h-12 flex-1 items-center justify-center rounded-2xl px-6 text-sm font-black lg:max-w-64">Показать автомобили</button>
  </div>;
}

async function loadElectricFacets() {
  const response = await fetch("/api/catalog/search?fuel=electric&pageSize=1&includeFacets=1", { cache: "no-store" });
  if (!response.ok) throw new Error(`catalog_electric_facets_http_${response.status}`);
  const payload = await response.json();
  if (!payload?.facets) throw new Error("catalog_electric_facets_missing");
  return payload.facets as Facets;
}

function RangeFields({ fromName, toName, fromValue, toValue, fromPlaceholder, toPlaceholder, inputMode = "numeric" }: { fromName: string; toName: string; fromValue?: string; toValue?: string; fromPlaceholder: string; toPlaceholder: string; inputMode?: "numeric" | "decimal" }) {
  return <div className="ac-filter-range grid grid-cols-2 overflow-hidden rounded-2xl"><input name={fromName} defaultValue={fromValue} inputMode={inputMode} placeholder={fromPlaceholder} autoFocus={false} className="ac-filter-input h-14 min-w-0 bg-transparent px-4 text-sm font-bold outline-none" /><input name={toName} defaultValue={toValue} inputMode={inputMode} placeholder={toPlaceholder} autoFocus={false} className="ac-filter-input h-14 min-w-0 bg-transparent px-4 text-sm font-bold outline-none" /></div>;
}

function ElectricCheckbox({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="ac-filter-control ac-electric-filter flex min-h-14 cursor-pointer items-center gap-2 rounded-2xl px-4 text-sm font-black"><input type="checkbox" name="fuel" value="electric" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" /><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sm transition" style={{ background: checked ? "#ffd21f" : "var(--ac-surface-3)", border: checked ? "1px solid #ffd21f" : "1px solid rgba(103,113,130,.55)", color: checked ? "#171a21" : "transparent" }}>✓</span><span className="text-[17px] leading-none text-[#ffd21f]" aria-hidden="true">⚡</span><span>Электро</span></label>;
}

function PowerLimitCheckbox({ initialChecked }: { initialChecked: boolean }) {
  const [checked, setChecked] = useState(initialChecked);
  const [infoOpen, setInfoOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => setChecked(initialChecked), [initialChecked]);
  useEffect(() => { if (!infoOpen) return; const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setInfoOpen(false); }; document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside); }, [infoOpen]);
  return <div ref={root} className={`relative ${infoOpen ? "z-[250]" : "z-0"}`}><label className="ac-filter-control ac-power-limit flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl px-4 pr-14 text-sm font-black"><input type="checkbox" name="powerTo" value="160" checked={checked} onChange={(event) => setChecked(event.target.checked)} className="sr-only" /><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-sm transition" style={{ background: checked ? "#ff353d" : "var(--ac-surface-3)", border: checked ? "1px solid #ff353d" : "1px solid rgba(103,113,130,.55)", color: checked ? "#ffffff" : "transparent" }}>✓</span><span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"><span>До 160 л.с.</span><span className="text-[11px] font-black text-red-500">свыше — полный утильсбор</span></span></label><button type="button" onClick={() => setInfoOpen((current) => !current)} className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-sm font-black" style={{ background: "var(--ac-surface-3)", border: "1px solid rgba(103,113,130,.45)" }} aria-label="Почему есть фильтр до 160 лошадиных сил" aria-expanded={infoOpen}>?</button>{infoOpen ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+8px)] rounded-2xl p-4 text-sm font-bold leading-6"><div className="font-black">Почему до 160 л.с.?</div><p className="mt-2 text-[var(--ac-muted)]">Мощность влияет на коэффициент утилизационного сбора. Для электромобилей и гибридов применяется расчётная мощность по документам.</p><p className="mt-2 font-black text-red-500">Свыше 160 л.с. итоговые платежи могут быть значительно выше.</p></div> : null}</div>;
}

function AdvancedFields({ initial, make, makeOptions, marketOptions, bodyOptions, transmissionOptions, fuelOptions, driveOptions, setMake, includePrimary = true, includeFuel = true }: { initial: Record<string, string>; make: string; makeOptions: Option[]; marketOptions: Option[]; bodyOptions: Option[]; transmissionOptions: Option[]; fuelOptions: Option[]; driveOptions: Option[]; setMake: (value: string) => void; includePrimary?: boolean; includeFuel?: boolean }) {
  return <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{includePrimary ? <><SearchSelect name="make" value={make} placeholder="Любая марка" searchPlaceholder="Найти марку" options={makeOptions} onChange={setMake} /><VehicleModelSearch value={initial.model || ""} make={make} onMakeChange={setMake} /><SimpleSelect name="market" value={initial.market || ""} placeholder="Все рынки" options={marketOptions} /></> : null}{bodyOptions.length > 1 ? <SimpleSelect name="bodyType" value={initial.bodyType || ""} placeholder="Любой кузов" options={bodyOptions} /> : null}{transmissionOptions.length > 1 ? <SimpleSelect name="transmission" value={initial.transmission || ""} placeholder="Любая трансмиссия" options={transmissionOptions} /> : null}<RangeFields fromName="yearFrom" toName="yearTo" fromValue={initial.yearFrom} toValue={initial.yearTo} fromPlaceholder="Год от" toPlaceholder="до" /><RangeFields fromName="budgetFrom" toName="budget" fromValue={initial.budgetFrom} toValue={initial.budget || initial.budgetTo} fromPlaceholder="Цена от, ₽" toPlaceholder="до" /><RangeFields fromName="mileageFrom" toName="mileageTo" fromValue={initial.mileageFrom} toValue={initial.mileageTo} fromPlaceholder="Пробег от, км" toPlaceholder="до" /><RangeFields fromName="engineFrom" toName="engineTo" fromValue={initial.engineFrom} toValue={initial.engineTo} fromPlaceholder="Объём от, см³" toPlaceholder="до" />{includeFuel && fuelOptions.length > 1 ? <SimpleSelect name="fuel" value={initial.fuel === "electric" ? "" : initial.fuel || ""} placeholder="Любое топливо" options={fuelOptions} /> : null}{driveOptions.length > 1 ? <SimpleSelect name="drive" value={initial.drive || ""} placeholder="Любой привод" options={driveOptions} /> : null}</div>;
}

export function CatalogFilters({ initial, facets }: { initial: Record<string, string>; facets?: Facets }) {
  const [make, setMake] = useState(initial.make || "");
  const [electricOnly, setElectricOnly] = useState(initial.fuel === "electric");
  const [electricFacets, setElectricFacets] = useState<Facets | null>(null);
  const hasAdvancedValue = Boolean(initial.advanced === "1" || initial.bodyType || initial.transmission || initial.yearFrom || initial.yearTo || initial.budgetFrom || initial.budget || initial.budgetTo || initial.mileageFrom || initial.mileageTo || initial.engineFrom || initial.engineTo || initial.powerFrom || initial.powerTo || (initial.fuel && initial.fuel !== "electric") || initial.drive);
  const [expanded, setExpanded] = useState(hasAdvancedValue);
  const [mobileOpen, setMobileOpen] = useState(false);
  const appliedFilters = useMemo(() => filterSummary(initial), [initial]);
  const formKey = useMemo(() => JSON.stringify(initial), [initial]);

  useEffect(() => {
    if (!electricOnly) { setElectricFacets(null); return; }
    let cancelled = false;
    loadElectricFacets().then((next) => { if (!cancelled) setElectricFacets(next); }).catch(() => { if (!cancelled) setElectricFacets({ makes: [], models: [], markets: [], bodyTypes: [], fuels: ["electric"], transmissions: [], drives: [] }); });
    return () => { cancelled = true; };
  }, [electricOnly]);

  const activeFacets = electricOnly ? electricFacets || facets : facets;
  const makeOptions = useMemo<Option[]>(() => [{ value: "", label: "Любая марка" }, ...[...new Set<string>([...(activeFacets?.makes || []), initial.make].map(clean).filter(Boolean))].sort((a, b) => label(a).localeCompare(label(b), "ru")).map((value) => ({ value, label: label(value) }))], [activeFacets, initial.make]);
  const marketOptions = markets;
  const bodyOptions = useMemo(() => catalogFilterOptions(bodies, activeFacets?.bodyTypes, initial.bodyType), [activeFacets, initial.bodyType]);
  const fuelOptions = useMemo(() => catalogFilterOptions(fuels, activeFacets?.fuels, initial.fuel), [activeFacets, initial.fuel]);
  const transmissionOptions = useMemo(() => catalogFilterOptions(transmissions, activeFacets?.transmissions, initial.transmission), [activeFacets, initial.transmission]);
  const driveOptions = useMemo(() => catalogFilterOptions(drives, activeFacets?.drives, initial.drive), [activeFacets, initial.drive]);

  useEffect(() => setMake(initial.make || ""), [initial.make]);
  useEffect(() => { if (make && !makeOptions.some((option) => option.value === make)) setMake(""); }, [make, makeOptions]);
  useEffect(() => { if (!mobileOpen) return; const old = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = old; }; }, [mobileOpen]);

  const setElectric = (checked: boolean) => { setElectricOnly(checked); setElectricFacets(null); };

  return <>
    <form key={`desktop-${formKey}`} method="get" className="ac-catalog-filter-panel ac-filter-panel mt-6 hidden rounded-[1.8rem] p-4 lg:block">
      <div className="grid grid-cols-4 gap-3">
        <SearchSelect name="make" value={make} placeholder="Любая марка" searchPlaceholder="Найти марку" options={makeOptions} onChange={setMake} />
        <VehicleModelSearch value={initial.model || ""} make={make} onMakeChange={setMake} />
        <SimpleSelect name="market" value={initial.market || ""} placeholder="Все рынки" options={marketOptions} />
        <SimpleSelect name="sort" value={initial.sort || ""} placeholder="Сортировка" options={sorts} />
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <PowerLimitCheckbox initialChecked={initial.powerTo === "160"} />
        <button type="button" onClick={() => setExpanded((current) => !current)} className="ac-advanced-toggle flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-black transition">{expanded ? "Скрыть расширенный поиск" : "Расширенный поиск"}<Chevron open={expanded} /></button>
        <ElectricCheckbox checked={electricOnly} onChange={setElectric} />
      </div>
      {expanded ? <div className="ac-advanced-fields mt-4 rounded-[1.35rem] p-4"><AdvancedFields initial={initial} make={make} makeOptions={makeOptions} marketOptions={marketOptions} bodyOptions={bodyOptions} transmissionOptions={transmissionOptions} fuelOptions={fuelOptions} driveOptions={driveOptions} setMake={setMake} includePrimary={false} includeFuel={!electricOnly} /></div> : null}
      <FilterActions />
    </form>

    <button type="button" onClick={() => setMobileOpen(true)} className="ac-filter-more-button mt-5 flex h-14 w-full items-center justify-between rounded-2xl px-4 text-sm font-black lg:hidden" aria-label="Открыть фильтры"><span>Фильтры</span><SlidersIcon /></button>

    {mobileOpen ? <div className="fixed inset-0 z-[9998] bg-black/70 lg:hidden" onClick={() => setMobileOpen(false)}><form key={`mobile-${formKey}`} method="get" className="ac-catalog-filter-drawer ac-hide-scrollbar absolute inset-y-0 right-0 w-[min(92vw,390px)] overflow-y-auto p-5 pb-8" onClick={(event) => event.stopPropagation()}><div className="mb-6 flex items-center justify-between"><h2 className="text-2xl font-black">Фильтры</h2><button type="button" onClick={() => setMobileOpen(false)} className="ac-filter-close flex h-10 w-10 items-center justify-center rounded-xl text-2xl" aria-label="Закрыть">×</button></div><div className="grid gap-3"><SimpleSelect name="sort" value={initial.sort || ""} placeholder="Сортировка" options={sorts} /><ElectricCheckbox checked={electricOnly} onChange={setElectric} /><PowerLimitCheckbox initialChecked={initial.powerTo === "160"} /><AdvancedFields initial={initial} make={make} makeOptions={makeOptions} marketOptions={marketOptions} bodyOptions={bodyOptions} transmissionOptions={transmissionOptions} fuelOptions={fuelOptions} driveOptions={driveOptions} setMake={setMake} includeFuel={!electricOnly} /><FilterActions mobile /></div></form></div> : null}
    {appliedFilters.length ? <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2" aria-label="Выбранные параметры"><span className="mr-1 text-xs font-black uppercase tracking-[0.12em] text-[var(--ac-muted)]">Выбрано</span>{appliedFilters.map((item) => <span key={item} className="rounded-full bg-white/[0.065] px-3 py-1.5 text-xs font-black text-[var(--ac-text)]">{item}</span>)}<Link href="/cars" className="px-2 py-1.5 text-xs font-black text-red-500">Сбросить всё</Link></div> : null}
  </>;
}
