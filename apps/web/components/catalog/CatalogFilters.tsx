"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { VehicleModelSearch } from "@/components/catalog/VehicleModelSearch";
import { CatalogBrandMultiSelect } from "@/components/catalog/CatalogBrandMultiSelect";
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
function splitMakeValues(value: string) { return [...new Set(String(value || "").split(",").map(clean).filter(Boolean))]; }
function joinMakeValues(values: string[]) { return [...new Set(values.map(clean).filter(Boolean))].join(","); }
function label(value: string) { return clean(value).replace(/\[object Object\]/gi, "") || "Без названия"; }
function Chevron({ open = false }: { open?: boolean }) { return <svg className={`shrink-0 transition ${open ? "rotate-180" : ""}`} width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function SlidersIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7H20M4 17H20M8 4V10M16 14V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="8" cy="7" r="2" fill="currentColor" /><circle cx="16" cy="17" r="2" fill="currentColor" /></svg>; }
function SortDirectionIcon({ direction, active }: { direction: SortDir; active: boolean }) { return <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 16V3M6 3L3.5 5.5M6 3L8.5 5.5" stroke={active && direction === "asc" ? "#ff353d" : "currentColor"} opacity={active && direction !== "asc" ? .42 : 1} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M14 4V17M14 17L11.5 14.5M14 17L16.5 14.5" stroke={active && direction === "desc" ? "#ff353d" : "currentColor"} opacity={active && direction !== "desc" ? .42 : 1} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

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
function catalogQuery(draft: FilterDraft, sortKey: SortKey, sortDirection: SortDir) {
  const params = new URLSearchParams();
  const add = (key: string, value: string) => { if (clean(value)) params.set(key, clean(value)); };
  add("make", draft.make); add("model", draft.model); add("market", draft.market);
  add("bodyType", draft.bodyType); add("transmission", draft.transmission); add("fuel", draft.fuel); add("drive", draft.drive);
  add("yearFrom", draft.yearFrom); add("yearTo", draft.yearTo);
  add("budgetFrom", draft.budgetFrom); add("budget", draft.budget);
  add("mileageFrom", draft.mileageFrom); add("mileageTo", draft.mileageTo);
  add("engineFrom", draft.engineFrom); add("engineTo", draft.engineTo); add("powerTo", draft.powerTo);
  const sort = sortParam(sortKey, sortDirection);
  if (sort) params.set("sort", sort);
  return params.toString();
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
      <button type="button" disabled={!sortKey} onClick={() => onDirectionChange(direction === "asc" ? "desc" : "asc")} className="ac-sort-direction flex items-center justify-center" aria-label={sortKey ? `Изменить порядок: ${caption}` : "Выберите сортировку по цене или году"} title={caption}><SortDirectionIcon direction={direction} active={Boolean(sortKey)} /></button>
    </div>
    {mobile ? <div className="mt-1.5 px-1 text-[11px] font-bold text-[var(--ac-muted)]">{caption}</div> : null}
  </div>;
}

function DualRange({ title, fromName, toName, fromValue, toValue, min, max, step, unit = "", format = formatNumber, onChange }: { title: string; fromName: string; toName: string; fromValue: string; toValue: string; min: number; max: number; step: number; unit?: string; format?: (value: number) => string; onChange: (from: string, to: string) => void }) {
  const [fromText, setFromText] = useState(fromValue);
  const [toText, setToText] = useState(toValue);
  useEffect(() => setFromText(fromValue), [fromValue]);
  useEffect(() => setToText(toValue), [toValue]);

  const digits = (value: string) => String(value || "").replace(/[^0-9]/g, "").slice(0, 10);
  const normalize = (value: string) => {
    const raw = digits(value);
    if (!raw) return "";
    const numeric = Math.min(max, Math.max(min, Number(raw)));
    const snapped = step > 1 ? Math.round(numeric / step) * step : Math.round(numeric);
    return String(Math.min(max, Math.max(min, snapped)));
  };
  const commit = (side: "from" | "to") => {
    let nextFrom = normalize(fromText);
    let nextTo = normalize(toText);
    if (nextFrom && nextTo && Number(nextFrom) > Number(nextTo)) {
      if (side === "from") nextTo = nextFrom;
      else nextFrom = nextTo;
    }
    setFromText(nextFrom);
    setToText(nextTo);
    onChange(nextFrom, nextTo);
  };
  const applyPreset = (from: string, to: string) => {
    setFromText(from);
    setToText(to);
    onChange(from, to);
  };
  const clear = () => applyPreset("", "");
  const summary = fromValue || toValue
    ? `${fromValue ? `от ${format(Number(fromValue))}${unit}` : "без минимума"} · ${toValue ? `до ${format(Number(toValue))}${unit}` : "без максимума"}`
    : "Без ограничений";
  const presets = title === "Год"
    ? [{ label: "2020+", from: "2020", to: "" }, { label: "2023+", from: "2023", to: "" }, { label: "2025+", from: "2025", to: "" }]
    : title === "Цена"
      ? [{ label: "до 2 млн", from: "", to: "2000000" }, { label: "до 3 млн", from: "", to: "3000000" }, { label: "до 5 млн", from: "", to: "5000000" }]
      : title === "Пробег"
        ? [{ label: "до 50 тыс.", from: "", to: "50000" }, { label: "до 100 тыс.", from: "", to: "100000" }, { label: "до 150 тыс.", from: "", to: "150000" }]
        : [{ label: "до 1.5 л", from: "", to: "1500" }, { label: "до 2.0 л", from: "", to: "2000" }, { label: "до 2.5 л", from: "", to: "2500" }];
  const keyHandler = (side: "from" | "to") => (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
    if (event.key === "Escape") {
      event.preventDefault();
      if (side === "from") setFromText(fromValue); else setToText(toValue);
      event.currentTarget.blur();
    }
  };

  return <div className="ac-range-card rounded-[17px] p-3.5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><div className="text-xs font-black uppercase tracking-[.08em] text-[var(--ac-muted)]">{title}</div><div className="mt-1 truncate text-[11px] font-bold text-[var(--ac-muted)]">{summary}</div></div>
      {fromValue || toValue ? <button type="button" onClick={clear} className="ac-range-clear flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base font-black text-[var(--ac-muted)]" aria-label={`Сбросить ${title}`}>×</button> : null}
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <label className="ac-range-input-wrap"><span>От</span><div className="ac-range-input-box"><input inputMode="numeric" autoComplete="off" value={fromText} onChange={(event) => setFromText(digits(event.target.value))} onBlur={() => commit("from")} onKeyDown={keyHandler("from")} placeholder="Не важно" aria-label={`${title}: от`} />{unit ? <small>{unit.trim()}</small> : null}</div></label>
      <label className="ac-range-input-wrap"><span>До</span><div className="ac-range-input-box"><input inputMode="numeric" autoComplete="off" value={toText} onChange={(event) => setToText(digits(event.target.value))} onBlur={() => commit("to")} onKeyDown={keyHandler("to")} placeholder="Не важно" aria-label={`${title}: до`} />{unit ? <small>{unit.trim()}</small> : null}</div></label>
    </div>
    <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label={`Быстрый выбор: ${title}`}>{presets.map((preset) => <button key={preset.label} type="button" onClick={() => applyPreset(preset.from, preset.to)} className="ac-range-preset rounded-full px-2.5 py-1.5 text-[10px] font-black">{preset.label}</button>)}</div>
    <input type="hidden" name={fromName} value={fromValue} /><input type="hidden" name={toName} value={toValue} />
  </div>;
}

function FilterChips({ chips, onRemove, compact = false }: { chips: FilterChip[]; onRemove: (key: string) => void; compact?: boolean }) {
  if (!chips.length) return null;
  return <div className={`flex min-w-0 flex-wrap items-center gap-2 ${compact ? "" : "mt-3"}`} aria-label="Выбранные параметры">{!compact ? <span className="mr-1 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--ac-muted)]"><span>Выбрано</span><span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black tracking-normal text-white">{chips.length}</span></span> : null}{chips.map((item) => <button key={item.key} type="button" onClick={() => onRemove(item.key)} className="ac-filter-chip flex min-h-8 max-w-full items-center gap-1.5 rounded-full px-3 text-xs font-black"><span className="truncate">{item.label}</span><span className="text-base leading-none opacity-55">×</span></button>)}</div>;
}

function AdvancedFields({ draft, setField, makeOptions, marketOptions, bodyOptions, transmissionOptions, fuelOptions, driveOptions, brandStatsContext, includePrimary = false, includeFuel = true }: { draft: FilterDraft; setField: (key: keyof FilterDraft, value: string) => void; makeOptions: Option[]; marketOptions: Option[]; bodyOptions: Option[]; transmissionOptions: Option[]; fuelOptions: Option[]; driveOptions: Option[]; brandStatsContext: string; includePrimary?: boolean; includeFuel?: boolean }) {
  return <>
    {includePrimary ? <div className="grid gap-2.5 md:grid-cols-3"><CatalogBrandMultiSelect value={draft.make} options={makeOptions} contextQuery={brandStatsContext} onChange={(value) => { setField("make", value); setField("model", ""); }} /><VehicleModelSearch value={draft.model} make={draft.make} onMakeChange={(value) => setField("make", value)} onValueChange={(value) => setField("model", value)} /><SimpleSelect name="market" value={draft.market} placeholder="Все рынки" options={marketOptions} onChange={(value) => setField("market", value)} /></div> : null}
    <div className={`ac-advanced-select-row grid grid-cols-2 gap-2.5 lg:grid-cols-4 ${includePrimary ? "mt-2.5" : ""}`}>{bodyOptions.length > 1 ? <SimpleSelect name="bodyType" value={draft.bodyType} placeholder="Любой кузов" options={bodyOptions} onChange={(value) => setField("bodyType", value)} /> : null}{transmissionOptions.length > 1 ? <SimpleSelect name="transmission" value={draft.transmission} placeholder="Любая трансмиссия" options={transmissionOptions} onChange={(value) => setField("transmission", value)} /> : null}{includeFuel && fuelOptions.length > 1 ? <SimpleSelect name="fuel" value={draft.fuel === "electric" ? "" : draft.fuel} placeholder="Любое топливо" options={fuelOptions.filter((item) => item.value !== "electric")} onChange={(value) => setField("fuel", value)} /> : null}{driveOptions.length > 1 ? <SimpleSelect name="drive" value={draft.drive} placeholder="Любой привод" options={driveOptions} onChange={(value) => setField("drive", value)} /> : null}</div>
    <div className="ac-range-fields-shell mt-2.5">
      <div className="flex items-end justify-between gap-3"><div className="text-[10px] font-black uppercase tracking-[.13em] text-[var(--ac-muted)]">Диапазоны</div><div className="text-right text-[10px] font-bold text-[var(--ac-muted)]">Введите «от» и/или «до» — пустое поле не ограничивает выдачу</div></div>
      <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DualRange title="Год" fromName="yearFrom" toName="yearTo" fromValue={draft.yearFrom} toValue={draft.yearTo} min={1990} max={new Date().getFullYear()} step={1} format={(value) => String(Math.round(value))} onChange={(from, to) => { setField("yearFrom", from); setField("yearTo", to); }} />
        <DualRange title="Цена" fromName="budgetFrom" toName="budget" fromValue={draft.budgetFrom} toValue={draft.budget} min={0} max={30_000_000} step={100_000} unit=" ₽" onChange={(from, to) => { setField("budgetFrom", from); setField("budget", to); }} />
        <DualRange title="Пробег" fromName="mileageFrom" toName="mileageTo" fromValue={draft.mileageFrom} toValue={draft.mileageTo} min={0} max={500_000} step={5_000} unit=" км" onChange={(from, to) => { setField("mileageFrom", from); setField("mileageTo", to); }} />
        <DualRange title="Объём двигателя" fromName="engineFrom" toName="engineTo" fromValue={draft.engineFrom} toValue={draft.engineTo} min={0} max={8_000} step={100} unit=" см³" onChange={(from, to) => { setField("engineFrom", from); setField("engineTo", to); }} />
      </div>
    </div>
  </>;
}


export function CatalogFilters({ initial, facets }: { initial: Record<string, string>; facets?: Facets }) {
  const router = useRouter();
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
    const nextInitial = draftFromInitial(initial);
    const initialSorting = initialSort(initial.sort || "");
    const serverQuery = catalogQuery(nextInitial, initialSorting.key, initialSorting.direction);
    const nextQuery = catalogQuery(draft, sortKey, sortDirection);
    if (nextQuery === serverQuery) return;
    const timer = window.setTimeout(() => {
      router.replace(nextQuery ? `/cars?${nextQuery}` : "/cars", { scroll: false });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draft, sortKey, sortDirection, formKey, initial, router]);

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
  const selectedMakes = useMemo(() => splitMakeValues(draft.make), [draft.make]);
  const makeOptions = useMemo<Option[]>(() => [{ value: "", label: "Любая марка" }, ...[...new Set<string>([...(activeFacets?.makes || []), ...selectedMakes].map(clean).filter(Boolean))].sort((a, b) => label(a).localeCompare(label(b), "ru")).map((value) => ({ value, label: label(value) }))], [activeFacets, selectedMakes]);
  const marketOptions = markets;
  const brandStatsContext = useMemo(() => {
    const contextDraft: FilterDraft = { ...draft, make: "", model: "" };
    return catalogQuery(contextDraft, "", "asc");
  }, [draft]);
  const bodyOptions = useMemo(() => catalogFilterOptions(bodies, activeFacets?.bodyTypes, draft.bodyType), [activeFacets, draft.bodyType]);
  const fuelOptions = useMemo(() => catalogFilterOptions(fuels, activeFacets?.fuels, draft.fuel), [activeFacets, draft.fuel]);
  const transmissionOptions = useMemo(() => catalogFilterOptions(transmissions, activeFacets?.transmissions, draft.transmission), [activeFacets, draft.transmission]);
  const driveOptions = useMemo(() => catalogFilterOptions(drives, activeFacets?.drives, draft.drive), [activeFacets, draft.drive]);

  const setField = (key: keyof FilterDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    if (!draft.make) return;
    const allowed = new Set(makeOptions.map((option) => option.value).filter(Boolean));
    const next = selectedMakes.filter((make) => allowed.has(make));
    const joined = joinMakeValues(next);
    if (joined !== draft.make) setDraft((current) => ({ ...current, make: joined, model: "" }));
  }, [draft.make, makeOptions, selectedMakes]);

  const chips = useMemo<FilterChip[]>(() => {
    const rows: FilterChip[] = [];
    splitMakeValues(draft.make).forEach((make) => rows.push({ key: `make:${make}`, label: make }));
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
    if (key.startsWith("make:")) {
      const removed = key.slice(5);
      return setDraft((current) => ({ ...current, make: joinMakeValues(splitMakeValues(current.make).filter((make) => make !== removed)), model: "" }));
    }
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
  return <>
    <form key={`desktop-${formKey}`} method="get" onSubmit={(event) => event.preventDefault()} className="ac-catalog-filter-panel ac-filter-panel mt-6 hidden rounded-[1.8rem] p-4 lg:block">
      <div className="grid grid-cols-3 gap-2.5">
        <CatalogBrandMultiSelect value={draft.make} options={makeOptions} contextQuery={brandStatsContext} onChange={(value) => { setField("make", value); setField("model", ""); }} />
        <VehicleModelSearch value={draft.model} make={draft.make} onMakeChange={(value) => setField("make", value)} onValueChange={(value) => setField("model", value)} />
        <SimpleSelect name="market" value={draft.market} placeholder="Все рынки" options={marketOptions} onChange={(value) => setField("market", value)} />
      </div>
      <div className="mt-2.5 grid grid-cols-[minmax(0,1.15fr)_minmax(155px,.58fr)_minmax(320px,1fr)_minmax(180px,.58fr)] items-center gap-2.5">
        <PowerLimitCheckbox checked={draft.powerTo === "160"} onChange={(checked) => setField("powerTo", checked ? "160" : "")} />
        <ElectricCheckbox checked={electricOnly} onChange={setElectric} />
        <SortControl sortKey={sortKey} direction={sortDirection} onKeyChange={chooseSort} onDirectionChange={setSortDirection} />
        <button type="button" onClick={() => setExpanded((current) => !current)} className={`ac-filter-settings relative flex h-13 min-w-0 items-center justify-center gap-2 rounded-[15px] px-3 text-xs font-black ${expanded ? "is-active" : ""}`} aria-label="Расширенные фильтры" aria-expanded={expanded}><SlidersIcon /><span className="whitespace-nowrap">{expanded ? "Скрыть" : "Ещё фильтры"}</span></button>
      </div>
      {expanded ? <section className="ac-advanced-fields mt-3"><AdvancedFields draft={draft} setField={setField} makeOptions={makeOptions} marketOptions={marketOptions} bodyOptions={bodyOptions} transmissionOptions={transmissionOptions} fuelOptions={fuelOptions} driveOptions={driveOptions} brandStatsContext={brandStatsContext} includeFuel={!electricOnly} /></section> : null}
      <FilterChips chips={chips} onRemove={removeFilter} />
    </form>

    <button type="button" onClick={() => setMobileOpen(true)} className="ac-filter-more-button mt-5 flex h-14 w-full items-center justify-between rounded-2xl px-4 text-sm font-black lg:hidden" aria-label="Открыть фильтры"><span className="flex items-center gap-2"><span>Фильтры</span>{chips.length ? <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] text-white">{chips.length}</span> : null}</span><SlidersIcon /></button>

    {mobileOpen ? <div className="ac-mobile-filter-backdrop fixed inset-0 z-[10040] flex items-end bg-black/65 backdrop-blur-md lg:hidden" onClick={() => setMobileOpen(false)}><form key={`mobile-${formKey}`} method="get" onSubmit={(event) => event.preventDefault()} role="dialog" aria-modal="true" aria-label="Фильтры каталога" className="ac-mobile-filter-sheet flex w-full max-h-[91dvh] flex-col overflow-hidden rounded-t-[30px] bg-[var(--ac-surface)] text-[var(--ac-text)]" onClick={(event) => event.stopPropagation()}>
      <div className="shrink-0 px-4 pt-2"><div className="mx-auto h-1.5 w-12 rounded-full bg-[var(--ac-muted)]/35" /><div className="flex items-center justify-between gap-3 pb-3 pt-3"><div><div className="text-[10px] font-black uppercase tracking-[.15em] text-red-500">Каталог</div><h2 className="mt-0.5 text-2xl font-black">Фильтры</h2></div><button type="button" onClick={() => setMobileOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ac-surface-2)] text-2xl" aria-label="Закрыть">×</button></div></div>
      <div className="ac-hide-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {chips.length ? <section className="mb-4"><div className="mb-2 text-[10px] font-black uppercase tracking-[.14em] text-[var(--ac-muted)]">Выбрано</div><FilterChips chips={chips} onRemove={removeFilter} compact /></section> : null}
        <section className="ac-mobile-filter-section"><div className="ac-mobile-filter-section__title">Сортировка</div><SortControl sortKey={sortKey} direction={sortDirection} onKeyChange={chooseSort} onDirectionChange={setSortDirection} mobile /></section>
        <section className="ac-mobile-filter-section"><div className="ac-mobile-filter-section__title">Быстрые параметры</div><div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"><ElectricCheckbox checked={electricOnly} onChange={setElectric} /><PowerLimitCheckbox checked={draft.powerTo === "160"} onChange={(checked) => setField("powerTo", checked ? "160" : "")} /></div></section>
        <section className="ac-mobile-filter-section"><div className="ac-mobile-filter-section__title">Автомобиль</div><AdvancedFields draft={draft} setField={setField} makeOptions={makeOptions} marketOptions={marketOptions} bodyOptions={bodyOptions} transmissionOptions={transmissionOptions} fuelOptions={fuelOptions} driveOptions={driveOptions} brandStatsContext={brandStatsContext} includePrimary includeFuel={!electricOnly} /></section>
      </div>
    </form></div> : null}

    <style jsx global>{`
      .ac-sort-control,.ac-filter-settings,.ac-filter-reset,.ac-range-card,.ac-filter-chip{background:var(--ac-surface-2);color:var(--ac-text);border:1px solid var(--ac-border)}
      .ac-sort-control>button+button{border-left:1px solid var(--ac-border)}
      .ac-sort-control button{color:var(--ac-muted);transition:background-color .16s ease,color .16s ease}
      .ac-sort-control button.is-active{background:var(--ac-surface-3);color:var(--ac-text)}
      .ac-sort-direction:disabled{opacity:.35;cursor:not-allowed}
      .ac-filter-settings{transition:background-color .16s ease,color .16s ease,transform .16s ease}
      .ac-filter-settings:hover,.ac-filter-settings.is-active{background:var(--ac-surface-3);color:#ff353d}
      .ac-filter-settings:active{transform:scale(.98)}
      .ac-advanced-fields{background:transparent}
      .ac-range-fields-shell{background:var(--ac-surface-2);border:1px solid var(--ac-border);border-radius:1.35rem;padding:13px 14px 14px}
      .ac-range-card{background:var(--ac-surface)}
      .ac-filter-chip{background:var(--ac-surface-2)}
      .ac-filter-chip:hover{background:var(--ac-surface-3)}
      .ac-range-clear,.ac-range-preset{background:var(--ac-surface-2);border:1px solid var(--ac-border);transition:background-color .15s ease,color .15s ease,border-color .15s ease}
      .ac-range-clear:hover,.ac-range-preset:hover{background:var(--ac-surface-3);color:var(--ac-text);border-color:rgba(255,53,61,.35)}
      .ac-range-input-wrap{display:block;min-width:0}
      .ac-range-input-wrap>span{display:block;margin:0 0 5px 2px;font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:var(--ac-muted)}
      .ac-range-input-box{display:flex;align-items:center;min-width:0;height:42px;border-radius:12px;background:var(--ac-surface-2);border:1px solid var(--ac-border);overflow:hidden;transition:border-color .15s ease,background-color .15s ease}
      .ac-range-input-box:focus-within{border-color:rgba(255,53,61,.72);background:var(--ac-surface-3)}
      .ac-range-input-box input{min-width:0;width:100%;height:100%;padding:0 10px;background:transparent!important;border:0!important;outline:0!important;color:var(--ac-text)!important;font-size:13px;font-weight:900;box-shadow:none!important}
      .ac-range-input-box input::placeholder{color:var(--ac-muted);opacity:.72;font-weight:700}
      .ac-range-input-box small{flex:none;padding-right:9px;color:var(--ac-muted);font-size:10px;font-weight:800;white-space:nowrap}
      .ac-range-preset{color:var(--ac-muted)}
      .ac-mobile-filter-section{margin-top:12px;padding:12px;border-radius:20px;background:var(--ac-surface-2)}
      .ac-mobile-filter-section__title{margin:0 0 9px;font-size:10px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:var(--ac-muted)}
      @media(max-width:1023px){
        .ac-mobile-filter-sheet .ac-filter-control,.ac-mobile-filter-sheet .ac-sort-control{min-height:52px;height:52px;border-radius:15px}
        .ac-mobile-filter-sheet .ac-filter-dropdown{position:static!important;inset:auto!important;margin-top:6px;background:var(--ac-surface-3);box-shadow:none!important;border:1px solid var(--ac-border)!important}
        .ac-mobile-filter-sheet .relative:has(>.ac-filter-dropdown){z-index:auto!important}
        .ac-mobile-filter-sheet .ac-filter-dropdown .ac-filter-option{background:transparent}
        .ac-mobile-filter-sheet .ac-filter-dropdown .ac-filter-option.is-active{background:rgba(255,53,61,.12);color:#ff5962}
        .ac-mobile-filter-sheet .ac-advanced-fields{background:transparent}
        .ac-mobile-filter-sheet .ac-range-fields-shell{background:transparent;border:0;border-radius:0;padding:0}
        .ac-mobile-filter-sheet .ac-range-card{background:var(--ac-surface)}
      }
      html[data-theme="light"] .ac-mobile-filter-sheet [class*="border-white/"]{border-color:rgba(30,36,48,.09)!important}
    `}</style>
  </>;
}
