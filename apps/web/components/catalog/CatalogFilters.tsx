"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Option = { value: string; label: string };
type Facets = { makes: string[]; models: Array<{ make: string; model: string }>; markets?: string[]; bodyTypes?: string[]; fuels?: string[]; transmissions?: string[]; drives?: string[] };


function clean(value: string) { return String(value || "").replace(/\s+/g, " ").trim(); }
function label(value: string) { return clean(value).replace(/\[object Object\]/gi, "") || "Без названия"; }
function Chevron({ open = false }: { open?: boolean }) { return <svg className={`shrink-0 transition ${open ? "rotate-180" : ""}`} width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function SlidersIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7H20M4 17H20M8 4V10M16 14V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="8" cy="7" r="2" fill="currentColor" /><circle cx="16" cy="17" r="2" fill="currentColor" /></svg>; }

function useDropdown(open: boolean, root: React.RefObject<HTMLDivElement | null>, close: () => void, focus?: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    if (focus) requestAnimationFrame(() => focus.current?.focus());
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [open, root, close, focus]);
}

function SearchSelect({ name, value, options, placeholder, searchPlaceholder, onChange, className = "" }: { name: string; value: string; options: Option[]; placeholder: string; searchPlaceholder: string; onChange?: (value: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(value);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const close = () => { setOpen(false); setQuery(""); };
  useDropdown(open, root, close, search);
  useEffect(() => setSelected(value), [value]);
  const filtered = useMemo(() => { const normalized = query.trim().toLocaleLowerCase("ru-RU"); return normalized ? options.filter((item) => item.label.toLocaleLowerCase("ru-RU").includes(normalized)) : options; }, [options, query]);
  const active = options.find((item) => item.value === selected);
  const choose = (next: string) => { setSelected(next); onChange?.(next); close(); };
  return <div ref={root} className={`relative min-w-0 ${open ? "z-[230]" : "z-0"} ${className}`}><input type="hidden" name={name} value={selected} /><button type="button" onClick={() => setOpen((current) => !current)} className="ac-filter-control flex h-14 w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-sm font-black" aria-expanded={open}><span className="truncate">{active?.label || placeholder}</span><Chevron open={open} /></button>{open ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2"><div className="mb-1.5"><input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} className="ac-filter-search h-10 w-full rounded-xl px-3 text-sm font-bold outline-none" /></div><div className="ac-hide-scrollbar max-h-64 overflow-y-auto">{filtered.length ? filtered.map((item) => <button key={item.value || "any"} type="button" onClick={() => choose(item.value)} className={`ac-filter-option flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${selected === item.value ? "is-active" : ""}`}><span>{item.label}</span>{selected === item.value ? <span>✓</span> : null}</button>) : <div className="px-3 py-5 text-center text-sm font-bold text-white/40">Ничего не найдено</div>}</div></div> : null}</div>;
}

function SimpleSelect({ name, value, options, placeholder, className = "" }: { name: string; value: string; options: Option[]; placeholder: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDropdown(open, root, close);
  useEffect(() => setSelected(value), [value]);
  const active = options.find((item) => item.value === selected);
  return <div ref={root} className={`relative min-w-0 ${open ? "z-[220]" : "z-0"} ${className}`}><input type="hidden" name={name} value={selected} /><button type="button" onClick={() => setOpen((current) => !current)} className="ac-filter-control flex h-14 w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-sm font-black" aria-expanded={open}><span className="truncate">{active?.label || placeholder}</span><Chevron open={open} /></button>{open ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2"><div className="ac-hide-scrollbar max-h-64 overflow-y-auto">{options.map((item) => <button key={item.value || "any"} type="button" onClick={() => { setSelected(item.value); close(); }} className={`ac-filter-option flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${selected === item.value ? "is-active" : ""}`}><span>{item.label}</span>{selected === item.value ? <span>✓</span> : null}</button>)}</div></div> : null}</div>;
}

const markets: Option[] = [{ value: "", label: "Все рынки" }, { value: "korea", label: "Корея" }, { value: "china", label: "Китай" }, { value: "japan", label: "Япония" }, { value: "uae", label: "ОАЭ" }, { value: "europe", label: "Европа" }];
const bodies: Option[] = [{ value: "", label: "Любой кузов" }, { value: "suv", label: "Кроссовер" }, { value: "offroad", label: "Внедорожник" }, { value: "sedan", label: "Седан" }, { value: "hatchback", label: "Хэтчбек" }, { value: "wagon", label: "Универсал" }, { value: "minivan", label: "Минивэн" }, { value: "coupe", label: "Купе" }, { value: "convertible", label: "Кабриолет" }, { value: "pickup", label: "Пикап" }, { value: "van", label: "Фургон" }];
const fuels: Option[] = [{ value: "", label: "Любое топливо" }, { value: "petrol", label: "Бензин" }, { value: "diesel", label: "Дизель" }, { value: "hybrid", label: "Гибрид" }, { value: "electric", label: "Электро" }, { value: "lpg", label: "Газ" }];
const transmissions: Option[] = [{ value: "", label: "Любая трансмиссия" }, { value: "automatic", label: "Автомат" }, { value: "manual", label: "Механика" }, { value: "cvt", label: "Вариатор" }, { value: "dct", label: "Робот" }];
const drives: Option[] = [{ value: "", label: "Любой привод" }, { value: "fwd", label: "Передний" }, { value: "rwd", label: "Задний" }, { value: "awd", label: "Полный" }];
const prices: Option[] = [{ value: "", label: "С ценой и без" }, { value: "yes", label: "Только с ценой" }, { value: "no", label: "Цена уточняется" }];
function onlyAvailable(options: Option[], values?: string[]) { const allowed = new Set((values || []).map(clean)); return [options[0], ...options.slice(1).filter((option) => allowed.has(clean(option.value)))]; }

function RangeFields({ fromName, toName, fromValue, toValue, fromPlaceholder, toPlaceholder, inputMode = "numeric" }: { fromName: string; toName: string; fromValue?: string; toValue?: string; fromPlaceholder: string; toPlaceholder: string; inputMode?: "numeric" | "decimal" }) { return <div className="ac-filter-range grid grid-cols-2 overflow-hidden rounded-2xl"><input name={fromName} defaultValue={fromValue} inputMode={inputMode} placeholder={fromPlaceholder} className="ac-filter-input h-14 min-w-0 bg-transparent px-4 text-sm font-bold outline-none" /><input name={toName} defaultValue={toValue} inputMode={inputMode} placeholder={toPlaceholder} className="ac-filter-input h-14 min-w-0 bg-transparent px-4 text-sm font-bold outline-none" /></div>; }
function AdvancedFields({ initial, make, makeOptions, modelOptions, marketOptions, bodyOptions, transmissionOptions, fuelOptions, driveOptions, setMake, includePrimary = true }: { initial: Record<string, string>; make: string; makeOptions: Option[]; modelOptions: Option[]; marketOptions: Option[]; bodyOptions: Option[]; transmissionOptions: Option[]; fuelOptions: Option[]; driveOptions: Option[]; setMake: (value: string) => void; includePrimary?: boolean }) { return <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{includePrimary ? <><SearchSelect name="make" value={make} placeholder="Любая марка" searchPlaceholder="Найти марку" options={makeOptions} onChange={setMake} /><SearchSelect key={`advanced-${make}`} name="model" value={initial.make === make ? initial.model || "" : ""} placeholder="Любая модель" searchPlaceholder="Найти модель" options={modelOptions} /><SimpleSelect name="market" value={initial.market || ""} placeholder="Все рынки" options={marketOptions} /></> : null}{bodyOptions.length > 1 ? <SimpleSelect name="bodyType" value={initial.bodyType || ""} placeholder="Любой кузов" options={bodyOptions} /> : null}{transmissionOptions.length > 1 ? <SimpleSelect name="transmission" value={initial.transmission || ""} placeholder="Любая трансмиссия" options={transmissionOptions} /> : null}<RangeFields fromName="yearFrom" toName="yearTo" fromValue={initial.yearFrom} toValue={initial.yearTo} fromPlaceholder="Год от" toPlaceholder="до" /><RangeFields fromName="budgetFrom" toName="budget" fromValue={initial.budgetFrom} toValue={initial.budget} fromPlaceholder="Цена от, ₽" toPlaceholder="до" /><RangeFields fromName="mileageFrom" toName="mileageTo" fromValue={initial.mileageFrom} toValue={initial.mileageTo} fromPlaceholder="Пробег от, км" toPlaceholder="до" /><RangeFields fromName="engineFrom" toName="engineTo" fromValue={initial.engineFrom} toValue={initial.engineTo} fromPlaceholder="Объём от, см³" toPlaceholder="до" />{fuelOptions.length > 1 ? <SimpleSelect name="fuel" value={initial.fuel || ""} placeholder="Любое топливо" options={fuelOptions} /> : null}{driveOptions.length > 1 ? <SimpleSelect name="drive" value={initial.drive || ""} placeholder="Любой привод" options={driveOptions} /> : null}<SimpleSelect name="hasPrice" value={initial.hasPrice || ""} placeholder="С ценой и без" options={prices} /></div>; }

export function CatalogFilters({ initial, facets }: { initial: Record<string, string>; facets?: Facets }) {
  const [make, setMake] = useState(initial.make || "");
  const hasAdvancedValue = Boolean(initial.advanced === "1" || initial.bodyType || initial.transmission || initial.yearFrom || initial.yearTo || initial.budgetFrom || initial.budget || initial.mileageFrom || initial.mileageTo || initial.engineFrom || initial.engineTo || initial.fuel || initial.drive || initial.hasPrice);
  const [expanded, setExpanded] = useState(hasAdvancedValue);
  const [mobileOpen, setMobileOpen] = useState(false);
  const makeOptions = useMemo<Option[]>(() => [{ value: "", label: "Любая марка" }, ...[...new Set((facets?.makes || []).map(clean).filter(Boolean))].sort((a, b) => label(a).localeCompare(label(b), "ru")).map((value) => ({ value, label: label(value) }))], [facets]);
  const modelOptions = useMemo<Option[]>(() => { if (!make) return [{ value: "", label: "Любая модель" }]; const values = (facets?.models || []).filter((item) => clean(item.make) === clean(make)).map((item) => clean(item.model)); return [{ value: "", label: "Любая модель" }, ...[...new Set(values.filter(Boolean))].sort((a, b) => label(a).localeCompare(label(b), "ru")).map((value) => ({ value, label: label(value) }))]; }, [facets, make]);
  const marketOptions = useMemo(() => onlyAvailable(markets, facets?.markets), [facets]);
  const bodyOptions = useMemo(() => onlyAvailable(bodies, facets?.bodyTypes), [facets]);
  const fuelOptions = useMemo(() => onlyAvailable(fuels, facets?.fuels), [facets]);
  const transmissionOptions = useMemo(() => onlyAvailable(transmissions, facets?.transmissions), [facets]);
  const driveOptions = useMemo(() => onlyAvailable(drives, facets?.drives), [facets]);
  useEffect(() => setMake(initial.make || ""), [initial.make]);
  useEffect(() => { if (!mobileOpen) return; const old = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = old; }; }, [mobileOpen]);

  return <>
    <form method="get" className="ac-catalog-filter-panel ac-filter-panel mt-6 hidden rounded-[1.8rem] p-4 lg:block">
      <div className={`grid gap-3 ${expanded ? "grid-cols-3" : "grid-cols-[1fr_1fr_1fr_auto]"}`}><SearchSelect name="make" value={make} placeholder="Любая марка" searchPlaceholder="Найти марку" options={makeOptions} onChange={setMake} /><SearchSelect key={`desktop-${make}`} name="model" value={initial.make === make ? initial.model || "" : ""} placeholder="Любая модель" searchPlaceholder="Найти модель" options={modelOptions} /><SimpleSelect name="market" value={initial.market || ""} placeholder="Все рынки" options={marketOptions} />{!expanded ? <button className="avto-button h-14 rounded-2xl px-12 text-base font-black">Найти</button> : null}</div>
      <button type="button" onClick={() => setExpanded((current) => !current)} className="ac-advanced-toggle mx-auto mt-4 flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-black transition">{expanded ? "Скрыть расширенный поиск" : "Расширенный поиск"}<Chevron open={expanded} /></button>
      {expanded ? <div className="ac-advanced-fields mt-4 rounded-[1.35rem] p-4"><AdvancedFields initial={initial} make={make} makeOptions={makeOptions} modelOptions={modelOptions} marketOptions={marketOptions} bodyOptions={bodyOptions} transmissionOptions={transmissionOptions} fuelOptions={fuelOptions} driveOptions={driveOptions} setMake={setMake} includePrimary={false} /><button className="avto-button mt-4 h-14 w-full rounded-2xl text-base font-black">Найти</button></div> : null}
    </form>

    <button type="button" onClick={() => setMobileOpen(true)} className="ac-filter-more-button mt-5 flex h-14 w-full items-center justify-between rounded-2xl px-4 text-sm font-black lg:hidden" aria-label="Открыть фильтры"><span>Фильтры</span><SlidersIcon /></button>

    {mobileOpen ? <div className="fixed inset-0 z-[9998] bg-black/70 lg:hidden" onClick={() => setMobileOpen(false)}><form method="get" className="ac-catalog-filter-drawer ac-hide-scrollbar absolute inset-y-0 right-0 w-[min(92vw,390px)] overflow-y-auto p-5 pb-8" onClick={(event) => event.stopPropagation()}><div className="mb-6 flex items-center justify-between"><h2 className="text-2xl font-black">Фильтры</h2><button type="button" onClick={() => setMobileOpen(false)} className="ac-filter-close flex h-10 w-10 items-center justify-center rounded-xl text-2xl" aria-label="Закрыть">×</button></div><AdvancedFields initial={initial} make={make} makeOptions={makeOptions} modelOptions={modelOptions} marketOptions={marketOptions} bodyOptions={bodyOptions} transmissionOptions={transmissionOptions} fuelOptions={fuelOptions} driveOptions={driveOptions} setMake={setMake} /><button className="avto-button mt-8 h-14 w-full rounded-2xl text-base font-black">Показать результаты</button></form></div> : null}
  </>;
}
