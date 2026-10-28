"use client";
import {CatalogFilterPending} from './CatalogFilterPending';
import {AUCTION_SALE_PERIODS} from "@/lib/catalog/auction-sale-period";
import {CatalogChevron as Chevron} from "./CatalogChevron";
import {CatalogColorSelect} from "./CatalogColorSelect";
import {CatalogSortSelect} from "./CatalogSortSelect";
import {normalizedCatalogSort} from "@/lib/catalog/catalog-sort";
import {filterSelections} from '@/lib/catalog/filter-selections';
import {CHINA_MIN_MODEL_YEAR} from "@/lib/catalog/china-year-policy";
import {JAPAN_MIN_MODEL_YEAR} from "@/lib/catalog/japan-year-policy";
import {rememberFilterScroll,restoreFilterScroll,lockFilterScrollAnchor} from "@/lib/catalog/filter-scroll";
import {SELECTION_EVENT,OPEN_SELECTION_FILTERS} from "@/lib/dealers/selection-share";
import {SelectedFilterChip} from "./SelectedFilterChip";
import {CatalogDesktopSelection} from "./CatalogSelectionContext";
import {StickyCatalogControls} from "./StickyCatalogControls";
import {createPortal} from "react-dom";
import {CatalogMarketFlag} from "./CatalogMarketFlag";
import {useDealerBrowsing} from "@/components/dealers/DealerBrowsingContext";
import {dealerBrowsingHref} from "@/lib/dealers/browsing-context";
import { CityPickerDialog, LocationIcon } from "../home/CitySelector";
import { useSelectedCity } from "../../lib/location/selected-city";
import { persistCity, readSelectedCity } from "../../lib/location/selected-city";
import { parseEngineCc } from "../../lib/catalog/engine-input";

import { CatalogFilterUiEnhancer } from "./CatalogFilterUiEnhancer";

import "./MobileCatalogDropdowns.css";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { VehicleModelSearch } from "@/components/catalog/VehicleModelSearch";
import { CatalogBrandMultiSelect } from "@/components/catalog/CatalogBrandMultiSelect";
import { catalogFilterOptions } from "@/lib/catalog/filter-options";
import { CATALOG_MARKET_LABELS, PUBLIC_CATALOG_MARKETS } from "@/lib/catalog/runtime-config";

import { auctionGradeColorClass } from "@/lib/catalog/auction-grade-color";
import { auctionGradeSelections } from "@/lib/catalog/auction-grade-filter";

type Option = { value: string; label: string };
type Facets = { makes: string[]; models: Array<{ make: string; model: string; aliases?: string[] }>; markets?: string[]; bodyTypes?: string[]; fuels?: string[]; transmissions?: string[]; drives?: string[] };
type SortKey = string;
type SortDir = "asc" | "desc";
type FilterDraft = {
  salePeriod:string;
  color: string;
  make: string;
  model: string;
  market: string;
  stock: string;
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
  auctionGrade: string;
  chassis:string;
  frameNumber:string;
  lotNumber:string;
};
type FilterChip = { key: string; label: string; grade?: string };

function clean(value: string) { return String(value || "").replace(/\s+/g, " ").trim(); }
function splitMakeValues(value: string) { return [...new Set(String(value || "").split(",").map(clean).filter(Boolean))]; }
function joinMakeValues(values: string[]) { return [...new Set(values.map(clean).filter(Boolean))].join(","); }
function label(value: string) { return clean(value).replace(/\[object Object\]/gi, "") || "Без названия"; }

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
  const multiple=["salePeriod","market","bodyType","transmission","fuel","drive"].includes(name);
  const selected=filterSelections(value);
  const active=options.find(item=>item.value===value);
  const chosen=(item:string)=>item?selected.includes(item):!selected.length;
  const choose=(next:string)=>{
    // Green Corner is a separate stock route, not an additional source market.
    if(name==="market"&&(next==="green"||selected.includes("green"))){onChange(next===value?"":next);return;}
    if(multiple){onChange(!next?"":selected.includes(next)?selected.filter(v=>v!==next).join("|"):[...selected,next].join("|"));}else{onChange(next);close();}
  };
  const title=multiple&&selected.length?selected.map(v=>options.find(o=>o.value===v)?.label||v).join(", "):active?.label||placeholder;
  return <div ref={root} className={`relative min-w-0 ${open ? "z-[220]" : "z-0"} ${className}`}>
    <input type="hidden" name={name} value={value} />
    <button type="button" onClick={() => setOpen((current) => !current)} className={`${name === "auctionGrade" && value ? `ac-japan-badge ${auctionGradeColorClass(value)}` : "ac-filter-control"} flex h-13 w-full items-center justify-between gap-2 rounded-[15px] px-4 text-left text-sm font-black`} aria-expanded={open}><span className="flex min-w-0 items-center gap-2 truncate">{name==="market"&&value&&selected.length===1&&<span aria-hidden="true"><CatalogMarketFlag market={value} className="h-4 w-6 shrink-0"/></span>}{title}</span><Chevron open={open} /></button>
    {open ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2"><div className="ac-hide-scrollbar max-h-64 overflow-y-auto">{options.map((item) => <button key={item.value || "any"} type="button" onClick={() => choose(item.value)} aria-label={item.label} aria-pressed={chosen(item.value)} className={`ac-filter-option flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${chosen(item.value) ? "is-active" : ""}`}><span className="flex items-center gap-2">{name==="market"&&item.value&&<span aria-hidden="true"><CatalogMarketFlag market={item.value} className="h-4 w-6 shrink-0"/></span>}{item.label}</span>{chosen(item.value) ? <span>✓</span> : null}</button>)}</div></div> : null}
  </div>;
}

const auctionGrades: Option[] = [{ value: "", label: "Любая оценка" }, ...["S", "6", "5.5", "5", "4.5", "4", "3.5", "3", "2", "1", "0", "R", "RA", "RB", "***", "**", "*", "A", "B", "C", "D", "E", "F", "0.5", "1.5", "2.5", "6.5", "7", "8", "9", "10"].map(value => ({ value, label: `Оценка ${value}` }))];

function AuctionGradeSelect({value, onChange}: {value: string; onChange: (value: string) => void}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDropdown(open, root, () => setOpen(false));
  const selected = auctionGradeSelections(value);
  return <div ref={root} className={`relative min-w-0 ${open ? "z-[220]" : "z-0"}`}>
    <input type="hidden" name="auctionGrade" value={value} />
    <button type="button" aria-label="Аукционные оценки" aria-expanded={open} onClick={() => setOpen(current => !current)} className={`${selected.length === 1 ? `ac-japan-badge ${auctionGradeColorClass(selected[0])}` : "ac-filter-control"} flex h-13 w-full items-center justify-between gap-2 rounded-[15px] px-4 text-left text-sm font-black`}><span className="truncate">{selected.length ? `${selected.length === 1 ? "Оценка" : "Оценки"} ${selected.join(", ")}` : "Любая оценка"}</span><Chevron open={open} /></button>
    {open ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2">
      <p className="px-3 py-2 text-xs text-[var(--ac-muted)]">Можно выбрать несколько</p>
      <button type="button" onClick={() => onChange("")} className="ac-filter-option min-h-10 w-full rounded-xl px-3 py-2 text-left text-sm font-bold">Любая оценка{!selected.length ? " ✓" : ""}</button>
      <div className="ac-hide-scrollbar max-h-64 overflow-y-auto" role="group" aria-label="Выберите оценки">{auctionGrades.filter(item => item.value).map(item => <label key={item.value} className={`ac-filter-option flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold ${selected.includes(item.value) ? "is-active" : ""}`}><input type="checkbox" className="h-4 w-4 accent-red-500" checked={selected.includes(item.value)} onChange={() => onChange((selected.includes(item.value) ? selected.filter(grade => grade !== item.value) : [...selected, item.value]).join("|"))} /><span>{item.label}</span></label>)}</div>
      <button type="button" onClick={() => setOpen(false)} className="ac-filter-option min-h-11 w-full rounded-xl px-3 py-2 text-sm font-bold">Готово</button>
    </div> : null}
  </div>;
}

const markets: Option[] = [{ value: "", label: "Все рынки" }, ...PUBLIC_CATALOG_MARKETS.flatMap((value) => value==="japan"?[{value:"japan",label:"Япония · Аукционы"},{value:"green",label:"Япония · Зелёный угол"}]:[{ value, label: CATALOG_MARKET_LABELS[value] }])];
const bodies: Option[] = [{ value: "", label: "Любой кузов" }, { value: "suv", label: "Кроссовер" }, { value: "offroad", label: "Внедорожник" }, { value: "sedan", label: "Седан" }, { value: "hatchback", label: "Хэтчбек" }, { value: "wagon", label: "Универсал" }, { value: "minivan", label: "Минивэн" }, { value: "coupe", label: "Купе" }, { value: "convertible", label: "Кабриолет" }, { value: "pickup", label: "Пикап" }, { value: "van", label: "Фургон" }];
const fuels: Option[] = [{ value: "", label: "Любое топливо" }, { value: "electrified", label: "Электромобили и гибриды" }, { value: "petrol", label: "Бензин" }, { value: "diesel", label: "Дизель" }, { value: "hybrid", label: "Гибрид" }, { value: "electric", label: "Электро" }, { value: "lpg", label: "Газ" }];
const transmissions: Option[] = [{ value: "", label: "Любая трансмиссия" }, { value: "automatic", label: "Автомат" }, { value: "manual", label: "Механика" }, { value: "cvt", label: "Вариатор" }, { value: "dct", label: "Робот" }];
const drives: Option[] = [{ value: "", label: "Любой привод" }, { value: "fwd", label: "Передний" }, { value: "rwd", label: "Задний" }, { value: "awd", label: "Полный" }];

function optionLabel(options: Option[], value: string) { return filterSelections(value).map(value=>options.find(option=>option.value===value)?.label||label(value)).join(", "); }
function formatNumber(value: number) { return new Intl.NumberFormat("ru-RU").format(Math.round(value)); }
function draftFromInitial(initial: Record<string, string>): FilterDraft {
  return {
    salePeriod:initial.salePeriod||"",
    color: initial.color || "",
    stock: initial.stock || "",
    chassis:initial.chassis||"",frameNumber:initial.frameNumber||"",lotNumber:initial.lotNumber||"",
    make: initial.make || "", model: initial.model || "", market: initial.market || "", bodyType: initial.bodyType || "", transmission: initial.transmission || "",
    yearFrom: initial.yearFrom || "", yearTo: initial.yearTo || "", budgetFrom: initial.budgetFrom || "", budget: (initial.budget || initial.budgetTo) || "",
    mileageFrom: initial.mileageFrom || "", mileageTo: initial.mileageTo || "", engineFrom: initial.engineFrom || "", engineTo: initial.engineTo || "",
    auctionGrade: initial.market === "japan" ? auctionGradeSelections(initial.auctionGrade).join("|") : "",
    fuel: initial.fuel || "", drive: initial.drive || "", powerTo: initial.powerTo || "",
  };
}
function initialSort(sort: string): { key: SortKey; direction: SortDir } {
  if (sort === "totalRubDesc") return { key: "totalRub", direction: "desc" };
  if (sort === "totalRub") return { key: "totalRub", direction: "asc" };
  if (sort === "yearAsc") return { key: "year", direction: "asc" };
  if (sort === "year") return { key: "year", direction: "desc" };
  return { key: normalizedCatalogSort(sort), direction: "asc" };
}
function catalogQuery(draft: FilterDraft, sortKey: SortKey, sortDirection: SortDir) {
  const params = new URLSearchParams();
  const add = (key: string, value: string) => { if (clean(value)) params.set(key, clean(value)); };
  if (draft.market === "japan") { add("chassis",draft.chassis);add("frameNumber",draft.frameNumber);add("lotNumber",draft.lotNumber);add("auctionGrade", draft.auctionGrade); add("stock", draft.stock); }
  if(filterSelections(draft.market).includes("japan")&&draft.stock!=="green")add("salePeriod",draft.salePeriod);
  add("color", draft.color); add("make", draft.make); add("model", draft.model); add("market", draft.market);
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
  return normalizedCatalogSort(key);
}

function ElectricCheckbox({ value, onChange, disabled=false }: { value: string; onChange: (value: string) => void; disabled?:boolean }) {
 const [open,setOpen]=useState(false);
 const root=useRef<HTMLDivElement>(null);
 const choices=[...new Set(filterSelections(value).flatMap(v=>v==="electrified"?["electric","hybrid"]:[v]))];
 const selected=choices.some(v=>v==="electric"||v==="hybrid");
 const encode=(values:string[])=>values.length===2&&values.includes("electric")&&values.includes("hybrid")?"electrified":values.join("|");
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==="Escape")setOpen(false);};document.addEventListener("pointerdown",close);document.addEventListener("keydown",escape);return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",escape);};},[open]);
 const toggle=(fuel:string,checked:boolean)=>onChange(encode(checked?[...new Set([...choices,fuel])]:choices.filter(v=>v!==fuel)));
 return <div ref={root} className="ac-electric-options relative min-w-0">
  <div className="ac-filter-control ac-electric-filter flex min-h-13 items-center gap-2 rounded-[15px] px-4 text-sm font-black">
   <label className="flex min-h-13 min-w-0 flex-1 cursor-pointer items-center gap-3"><input type="checkbox" disabled={disabled} checked={selected} onChange={e=>onChange(encode(e.target.checked?[...new Set([...choices,"electric","hybrid"])]:choices.filter(v=>v!=="electric"&&v!=="hybrid")))} className="ac-unified-checkbox ac-quick-checkbox"/><span>Электро{value==="electric"?": электромобили":value==="hybrid"?": гибриды":""}</span></label>
   <button type="button" disabled={disabled} onClick={()=>setOpen(!open)} aria-label="Уточнить тип электрического автомобиля" aria-expanded={open} className="flex min-h-13 w-[17px] shrink-0 items-center justify-center text-[var(--ac-muted)]"><Chevron open={open}/></button>
  </div>
  {open ? <div className="absolute inset-x-0 top-full z-[120] mt-2 rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] px-4 py-2 text-sm font-semibold">
   {[["electric","Электромобили"],["hybrid","Гибриды"]].map(([fuel,label])=><label key={fuel} className="flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" checked={value===fuel||value==="electrified"} onChange={e=>toggle(fuel,e.target.checked)} className="ac-unified-checkbox ac-quick-checkbox"/>{label}</label>)}
  </div> : null}
 </div>;
}

function PowerLimitCheckbox({ checked, onChange, sourcePower=false }: { sourcePower?:boolean; checked: boolean; onChange: (checked: boolean) => void }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!infoOpen) return; const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setInfoOpen(false); }; document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside); }, [infoOpen]);
  return <div ref={root} className={`relative ${infoOpen ? "z-[250]" : "z-0"}`}><label className="ac-filter-control ac-power-limit flex min-h-13 cursor-pointer items-center gap-3 rounded-[15px] px-4 pr-12 text-sm font-black"><input type="checkbox" name="powerTo" value="160" checked={checked} onChange={(event) => onChange(event.target.checked)} className="ac-unified-checkbox ac-quick-checkbox" /><span className="ac-power-copy flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"><span>До 160 л.с.</span><span className="text-[10px] font-black text-red-500">{sourcePower ? "по данным продавца" : "свыше — полный утильсбор"}</span></span></label><button type="button" onClick={() => setInfoOpen((current) => !current)} className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-sm font-black" style={{ background: "var(--ac-surface-3)", border: "1px solid rgba(103,113,130,.45)" }} aria-label="Почему есть фильтр до 160 лошадиных сил" aria-expanded={infoOpen}>?</button>{infoOpen ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+8px)] rounded-2xl p-4 text-sm font-bold leading-6"><div className="font-black">Почему до 160 л.с.?</div><p className="mt-2 text-[var(--ac-muted)]">Мощность влияет на коэффициент утилизационного сбора. Для электромобилей и гибридов применяется расчётная мощность по документам.</p><p className="mt-2 font-black text-red-500">Свыше 160 л.с. итоговые платежи могут быть значительно выше.</p></div> : null}</div>;
}

function SortControl({ sortKey, direction, onChange, hidePrice=false,showAuctionDate=false }: { showAuctionDate?:boolean;hidePrice?:boolean; sortKey: SortKey; direction: SortDir; onChange: (key: SortKey, direction: SortDir) => void }) {
  return <CatalogSortSelect showAuctionDate={showAuctionDate} value={sortParam(sortKey,direction)} hidePrice={hidePrice} onChange={value=>{const next=initialSort(value);onChange(next.key,next.direction);}} />;
}

function DualRange({ title, fromName, toName, fromValue, toValue, min, max, step, unit = "", format = formatNumber, onChange }: { title: string; fromName: string; toName: string; fromValue: string; toValue: string; min: number; max: number; step: number; unit?: string; format?: (value: number) => string; onChange: (from: string, to: string) => void }) {
  const [fromText, setFromText] = useState(fromValue);
  const [toText, setToText] = useState(toValue);
  useEffect(() => setFromText(fromValue), [fromValue]);
  useEffect(() => setToText(toValue), [toValue]);

  const isEngine = fromName === "engineFrom";
  const digits = (value: string) => isEngine ? value.slice(0, 20) : String(value || "").replace(/[^0-9]/g, "").slice(0, 10);
  const normalize = (value: string) => {
    const raw = digits(value);
    if (!raw) return "";
    const numeric = Math.min(max, Math.max(min, isEngine ? (parseEngineCc(raw) ?? Number.NaN) : Number(raw)));
    if (!Number.isFinite(numeric)) return raw;
    const snapped = Math.round(numeric);
    return String(Math.min(max, Math.max(min, snapped)));
  };
  const commit = (side: "from" | "to") => {
    let nextFrom = normalize(fromText);
    let nextTo = normalize(toText);
    if (isEngine && ((nextFrom && !parseEngineCc(nextFrom)) || (nextTo && !parseEngineCc(nextTo)))) return;
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
    ? [{ label: `${min}+`, from: String(min), to: "" }, { label: "2023+", from: "2023", to: "" }, { label: "2025+", from: "2025", to: "" }]
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

  return <div className="ac-range-card rounded-[17px] p-3.5" data-year-min={title === "Год" ? min : undefined}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><div className="text-xs font-black normal-case tracking-normal text-[var(--ac-muted)]">{title}</div><div className="mt-1 truncate text-[11px] font-bold text-[var(--ac-muted)]">{summary}</div></div>
      {fromValue || toValue ? <button type="button" onClick={clear} className="ac-range-clear flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base font-black text-[var(--ac-muted)]" aria-label={`Сбросить ${title}`}>×</button> : null}
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <label className="ac-range-input-wrap"><span>От</span><div className="ac-range-input-box"><input inputMode={isEngine ? "decimal" : "numeric"} autoComplete="off" title={isEngine ? "Например: 1,5 л или 1498 см³" : undefined} value={fromText} onChange={(event) => setFromText(digits(event.target.value))} onBlur={() => commit("from")} onKeyDown={keyHandler("from")} placeholder="Не важно" aria-label={`${title}: от`} />{unit ? <small>{unit.trim()}</small> : null}</div></label>
      <label className="ac-range-input-wrap"><span>До</span><div className="ac-range-input-box"><input inputMode={isEngine ? "decimal" : "numeric"} autoComplete="off" title={isEngine ? "Например: 1,5 л или 1498 см³" : undefined} value={toText} onChange={(event) => setToText(digits(event.target.value))} onBlur={() => commit("to")} onKeyDown={keyHandler("to")} placeholder="Не важно" aria-label={`${title}: до`} />{unit ? <small>{unit.trim()}</small> : null}</div></label>
    </div>
    <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label={`Быстрый выбор: ${title}`}>{presets.map((preset) => <button key={preset.label} type="button" onClick={() => applyPreset(preset.from, preset.to)} className="ac-range-preset rounded-full px-2.5 py-1.5 text-[10px] font-black">{preset.label}</button>)}</div>
    <input type="hidden" name={fromName} value={fromValue} /><input type="hidden" name={toName} value={toValue} />
  </div>;
}

function FilterChips({ chips, onRemove, compact = false }: { chips: FilterChip[]; onRemove: (key: string) => void; compact?: boolean }) {
  if (!chips.length) return null;
  return <div className={`flex min-w-0 flex-wrap items-center gap-2 ${compact ? "" : "mt-3"}`} aria-label="Выбранные параметры">{!compact ? <span className="mr-1 inline-flex items-center gap-2 text-[10px] font-black normal-case tracking-normal text-[var(--ac-muted)]"><span>Выбрано</span><span className="ac-filter-count-badge flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black tracking-normal text-white" style={{ color: "#fff", WebkitTextFillColor: "#fff" }}>{chips.length}</span></span> : null}{chips.map((item) => <SelectedFilterChip key={item.key} chip={item} onRemove={onRemove} />)}</div>;
}

function AdvancedFields({ draft, setField, makeOptions, marketOptions, bodyOptions, transmissionOptions, fuelOptions, driveOptions, brandStatsContext, sourceModels, auctionResults=false, includePrimary = false, includeFuel = true }: { draft: FilterDraft; setField: (key: keyof FilterDraft, value: string) => void; makeOptions: Option[]; marketOptions: Option[]; bodyOptions: Option[]; transmissionOptions: Option[]; fuelOptions: Option[]; driveOptions: Option[]; brandStatsContext: string; sourceModels?:Facets["models"]; auctionResults?:boolean; includePrimary?: boolean; includeFuel?: boolean }) {
  return <>
    {includePrimary ? <div className="grid gap-2.5 md:grid-cols-3"><CatalogBrandMultiSelect value={draft.make} options={makeOptions} contextQuery={brandStatsContext} onChange={(value) => { setField("make", value); setField("model", ""); }} /><VehicleModelSearch multiple sourceItems={sourceModels} contextQuery={brandStatsContext} value={draft.model} make={draft.make} onMakeChange={(value) => setField("make", value)} onValueChange={(value) => setField("model", value)} /><SimpleSelect name="market" value={draft.market==="japan"&&draft.stock==="green"?"green":draft.market} placeholder="Все рынки" options={marketOptions} onChange={(value) => setField("market", value)} /></div> : null}
    <div className={`ac-advanced-select-row grid grid-cols-2 gap-2.5 lg:grid-cols-4 ${includePrimary ? "mt-2.5" : ""}`}>{bodyOptions.length > 1 ? <SimpleSelect name="bodyType" value={draft.bodyType} placeholder="Любой кузов" options={bodyOptions} onChange={(value) => setField("bodyType", value)} /> : null}{transmissionOptions.length > 1 ? <SimpleSelect name="transmission" value={draft.transmission} placeholder="Любая трансмиссия" options={transmissionOptions} onChange={(value) => setField("transmission", value)} /> : null}{includeFuel && fuelOptions.length > 1 ? <SimpleSelect name="fuel" value={draft.fuel} placeholder="Любое топливо" options={fuelOptions} onChange={(value) => setField("fuel", value)} /> : null}{driveOptions.length > 1 ? <SimpleSelect name="drive" value={draft.drive} placeholder="Любой привод" options={driveOptions} onChange={(value) => setField("drive", value)} /> : null}</div>
    {auctionResults&&draft.market==='japan'&&<div className="ac-japan-search-fields mt-2.5 grid grid-cols-2 gap-2.5">
      <input aria-label="Код кузова" name="chassis" value={draft.chassis} onChange={e=>setField('chassis',e.target.value.toUpperCase())} placeholder="Код кузова" maxLength={80} className="ac-filter-control min-w-0 h-13 w-full rounded-[15px] px-3 text-sm font-black outline-none"/>
      <input aria-label="Номер лота" name="lotNumber" value={draft.lotNumber} onChange={e=>setField('lotNumber',e.target.value.replace(/[^0-9]/g,''))} inputMode="numeric" maxLength={10} placeholder="Номер лота" className="ac-filter-control min-w-0 h-13 w-full rounded-[15px] px-3 text-sm font-black outline-none"/>
      <div className="col-span-2 min-w-0"><AuctionGradeSelect value={draft.auctionGrade} onChange={v=>setField('auctionGrade',v)}/></div>
    </div>}
    <div className="ac-range-fields-shell mt-2.5">
      <div className={`grid gap-3 md:grid-cols-2 xl:grid-cols-4`}>
        {filterSelections(draft.market).includes("japan")&&draft.stock!=="green"&&<div className="mb-3"><p className="mb-2 text-xs font-semibold text-[var(--ac-muted)]">Дата продажи на аукционе</p><SimpleSelect name="salePeriod" value={draft.salePeriod} placeholder="За всё время" options={[{value:"",label:"За всё время"},...AUCTION_SALE_PERIODS]} onChange={value=>setField("salePeriod",value)}/></div>}
        <DualRange title="Год" fromName="yearFrom" toName="yearTo" fromValue={draft.yearFrom} toValue={draft.yearTo} min={!draft.market || draft.market.includes("|") || draft.market === "uae" ? 1886 : draft.market === "china" ? CHINA_MIN_MODEL_YEAR : draft.market === "japan" ? JAPAN_MIN_MODEL_YEAR : new Date().getFullYear() - 6} max={new Date().getFullYear() + (!draft.market || draft.market === "uae" ? 1 : 0)} step={1} format={(value) => String(Math.round(value))} onChange={(from, to) => { setField("yearFrom", from); setField("yearTo", to); }} />
        {<DualRange title="Цена" fromName="budgetFrom" toName="budget" fromValue={draft.budgetFrom} toValue={draft.budget} min={0} max={30_000_000} step={100_000} unit=" ₽" onChange={(from, to) => { setField("budgetFrom", from); setField("budget", to); }} />}
        <DualRange title="Пробег" fromName="mileageFrom" toName="mileageTo" fromValue={draft.mileageFrom} toValue={draft.mileageTo} min={0} max={500_000} step={5_000} unit=" км" onChange={(from, to) => { setField("mileageFrom", from); setField("mileageTo", to); }} />
        <DualRange title="Объём двигателя" fromName="engineFrom" toName="engineTo" fromValue={draft.engineFrom} toValue={draft.engineTo} min={0} max={8_000} step={100} unit=" см³" onChange={(from, to) => { setField("engineFrom", from); setField("engineTo", to); }} />
      </div>
    </div>
    <div className="mt-2.5"><CatalogColorSelect value={draft.color} market={draft.market} stock={draft.stock} onChange={value=>setField("color",value)}/></div>
  </>;
}


export function CatalogFilters({ initial, facets, resultCount, auctionResults=false }: { initial: Record<string, string>; facets?: Facets; resultCount?: number; auctionResults?:boolean }) {
  const dealer=useDealerBrowsing();
  const sourceModels=auctionResults||initial.stock==="green"?facets?.models:undefined;
  const selectedCity=useSelectedCity();
  const router = useRouter();
  const [pending,startTransition]=useTransition();
  const submitted=useRef<string|null>(null);
  const formKey = useMemo(() => JSON.stringify(initial), [initial]);
  const [draft, setDraft] = useState<FilterDraft>(() => draftFromInitial(initial));
  const initialSortState = useMemo(() => initialSort(initial.sort || ""), [initial.sort]);
  const [sortKey, setSortKey] = useState<SortKey>(initialSortState.key);
  const [sortDirection, setSortDirection] = useState<SortDir>(initialSortState.direction);
  const hasAdvancedValue = Boolean(initial.advanced === "1" || initial.color || initial.frameNumber || initial.chassis || initial.lotNumber || initial.auctionGrade || initial.bodyType || initial.transmission || initial.yearFrom || initial.yearTo || initial.budgetFrom || initial.budget || initial.budgetTo || initial.mileageFrom || initial.mileageTo || initial.engineFrom || initial.engineTo || (initial.fuel && initial.fuel !== "electric") || initial.drive);
  const [expanded, setExpanded] = useState(hasAdvancedValue);
  const [mobileOpen, setMobileOpen] = useState(false);
  const acknowledgedQuery = useRef(catalogQuery(draftFromInitial(initial), initialSortState.key, initialSortState.direction));
  useLayoutEffect(()=>restoreFilterScroll(),[initial]);
  // Server HTML can be visible before this component has its event handlers.
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const updating = pending || catalogQuery(draft,sortKey,sortDirection) !== catalogQuery(draftFromInitial(initial),initialSortState.key,initialSortState.direction);

  useEffect(() => {
    const incomingSort=initialSort(initial.sort || "");
    const incoming=catalogQuery(draftFromInitial(initial),incomingSort.key,incomingSort.direction);
    const currentQuery = catalogQuery(draft, sortKey, sortDirection);
    // Local edits win even during the debounce window, before submitted is set.
    // Only the response matching the current draft may acknowledge those edits.
    if (currentQuery !== acknowledgedQuery.current && incoming !== currentQuery) return;
    acknowledgedQuery.current = incoming;
    submitted.current=null;
    setDraft(draftFromInitial(initial));
    const nextSort = initialSort(initial.sort || "");
    setSortKey(nextSort.key);
    setSortDirection(nextSort.direction);
  }, [formKey]);

  useEffect(() => {
    // Apply the current selection without a second confirmation on mobile.
    const nextInitial = draftFromInitial(initial);
    const initialSorting = initialSort(initial.sort || "");
    const serverQuery = catalogQuery(nextInitial, initialSorting.key, initialSorting.direction);
    const nextQuery = catalogQuery(draft, sortKey, sortDirection);
    if (nextQuery === serverQuery && submitted.current === null) return;
    const timer = window.setTimeout(() => {
      if(submitted.current===nextQuery)return;
      submitted.current=nextQuery;
      const query=new URLSearchParams(nextQuery);
      const current=new URLSearchParams(window.location.search);if(current.get("selection")==="1")query.set("selection","1");
      const city=readSelectedCity();if(city)query.set("city",city);
      for(const key of ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","yclid"]) { const value=current.get(key); if(value)query.set(key,value); }
      if(initial.source&&draft.market===initial.market)query.set('source',initial.source);
      const basePath=draft.market === "japan" && draft.stock === "green" ? "/cars/green" : "/cars";
      const href=dealerBrowsingHref(query.size ? `${basePath}?${query}` : basePath,dealer);
      rememberFilterScroll(href);
      startTransition(()=>router.push(href, { scroll: false }));
    // Let a chassis/lot/frame number be typed before spending supplier requests.
    }, auctionResults && (draft.chassis !== (initial.chassis || "") || draft.lotNumber !== (initial.lotNumber || "") || draft.frameNumber !== (initial.frameNumber || "")) ? 650 : 180);
    return () => window.clearTimeout(timer);
  }, [draft, sortKey, sortDirection, formKey, initial, router, mobileOpen]);

  useLayoutEffect(() => {
    if (!mobileOpen) return;
    const body = document.body;
    const html = document.documentElement;
    const scrollY = window.scrollY;
    const releaseAnchor=lockFilterScrollAnchor();
    const saved = { overflow: body.style.overflow, position: body.style.position, top: body.style.top, width: body.style.width, htmlOverflow: html.style.overflow, scrollBehavior: html.style.scrollBehavior };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    // Fixed body also stops background scrolling in mobile Safari.
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    html.style.overflow = "hidden";
    window.addEventListener("keydown", escape);
    return () => {
      body.style.overflow = saved.overflow; body.style.position = saved.position;
      body.style.top = saved.top; body.style.width = saved.width;
      html.style.overflow = saved.htmlOverflow;
      html.style.scrollBehavior = "auto";
      window.scrollTo({top:scrollY,behavior:"instant"});
      releaseAnchor();
      restoreFilterScroll();
      html.style.scrollBehavior = saved.scrollBehavior;
      window.removeEventListener("keydown", escape);
    };
  }, [mobileOpen]);

  useEffect(()=>{
    if(!dealer)return;
    const query=new URLSearchParams(catalogQuery(draft,sortKey,sortDirection));if(selectedCity)query.set('city',selectedCity);
    window.dispatchEvent(new CustomEvent(SELECTION_EVENT,{detail:{dealerId:dealer.id,query:query.toString(),pending:updating,filtersOpen:mobileOpen}}));
  },[dealer?.id,draft,sortKey,sortDirection,selectedCity,updating,mobileOpen]);
  useEffect(()=>{
    const open=(event:Event)=>{if(!dealer||(event as CustomEvent).detail?.dealerId!==dealer.id)return;if(window.matchMedia('(max-width:1023px)').matches)setMobileOpen(true);else{setExpanded(true);document.querySelector('.dealer-shared-catalog .ac-catalog-filter-panel')?.scrollIntoView({block:'center',behavior:'smooth'});}};
    window.addEventListener(OPEN_SELECTION_FILTERS,open);return()=>window.removeEventListener(OPEN_SELECTION_FILTERS,open);
  },[dealer?.id]);

  useEffect(()=>{
    if(!dealer || new URLSearchParams(window.location.search).get('filters')!=='1')return;
    if(window.matchMedia('(max-width:1023px)').matches)setMobileOpen(true);
    else document.querySelector('.dealer-shared-catalog .ac-catalog-filter-panel')?.scrollIntoView({block:'start'});
    const url=new URL(window.location.href);url.searchParams.delete('filters');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
  },[dealer?.id]);

  // Reuse the server's directory; a toggle must not launch a second full search.
  const activeFacets = facets;
  const selectedMakes = useMemo(() => splitMakeValues(draft.make), [draft.make]);
  const makeOptions = useMemo<Option[]>(() => [{ value: "", label: "Любая марка" }, ...[...new Set<string>([...(activeFacets?.makes || []), ...selectedMakes].map(clean).filter(Boolean))].sort((a, b) => label(a).localeCompare(label(b), "ru")).map((value) => ({ value, label: label(value) }))], [activeFacets, selectedMakes]);
  const marketOptions = dealer ? markets.filter(m=>!m.value||dealer.markets.includes((m.value==="green"?"japan":m.value) as any)) : markets;
  const brandStatsContext = useMemo(() => {
    const contextDraft: FilterDraft = { ...draft, make: "", model: "" };
    const params=new URLSearchParams(catalogQuery(contextDraft, '', 'asc'));if(initial.source&&draft.market===initial.market)params.set('source',initial.source);return params.toString();
  }, [draft]);
  const bodyOptions = useMemo(() => catalogFilterOptions(bodies, bodies.slice(1).map(option => option.value), draft.bodyType), [activeFacets, draft.bodyType,auctionResults]);
  const fuelOptions = useMemo(() => catalogFilterOptions(fuels, fuels.slice(1).map(option=>option.value), draft.fuel), [activeFacets, draft.fuel]);
  const transmissionOptions = useMemo(() => catalogFilterOptions(draft.stock === "green" ? [transmissions[0], ...(activeFacets?.transmissions||[]).map(value=>({value,label:`КПП: ${value}`}))] : transmissions, activeFacets?.transmissions, draft.transmission), [activeFacets, draft.transmission, draft.stock]);
  const driveOptions = useMemo(() => catalogFilterOptions(drives, activeFacets?.drives, draft.drive), [activeFacets, draft.drive]);

  // Green stock gearbox codes are source-specific (for example FAT/IAT);
  // do not reinterpret them as AT/CVT when the user changes source type.
  const setField = (key: keyof FilterDraft, value: string) => {if(key==="market"&&value!=="japan")setSortKey(current=>current.split(",").filter(term=>!term.startsWith("auctionDate")).join(","));setDraft((current) => key==="market"?{...current,market:value==="green"?"japan":value,stock:value==="green"?"green":"",auctionGrade:"",...((current.stock==="green")!==(value==="green")?{transmission:""}:{})}:{...current,[key]:value})};
  useEffect(() => {
    if (!draft.make) return;
    const allowed = new Set(makeOptions.map((option) => option.value).filter(Boolean));
    const next = selectedMakes.filter((make) => allowed.has(make));
    const joined = joinMakeValues(next);
    if (joined !== draft.make) setDraft((current) => ({ ...current, make: joined, model: "" }));
  }, [draft.make, makeOptions, selectedMakes]);

  const chips = useMemo<FilterChip[]>(() => {
    const rows: FilterChip[] = [];
    if(draft.color) rows.push({key:"color",label:`Цвет: ${draft.color}`});
    if(draft.salePeriod&&filterSelections(draft.market).includes("japan")&&draft.stock!=="green")rows.push({key:"salePeriod",label:filterSelections(draft.salePeriod).map(v=>AUCTION_SALE_PERIODS.find(p=>p.value===v)?.label||v).join(", ")});
    if(draft.market==='japan'&&draft.frameNumber)rows.push({key:'frameNumber',label:`Номер кузова ${draft.frameNumber}`});
    if(draft.market==='japan'&&draft.chassis)rows.push({key:'chassis',label:`Кузов ${draft.chassis}`});
    if(draft.market==='japan'&&draft.lotNumber)rows.push({key:'lotNumber',label:`Лот ${draft.lotNumber}`});
    splitMakeValues(draft.make).forEach((make) => rows.push({ key: `make:${make}`, label: make }));
    if (draft.market === "japan") auctionGradeSelections(draft.auctionGrade).forEach(grade => rows.push({key: `auctionGrade:${grade}`, label: `Оценка ${grade}`, grade}));
    if (draft.market === "japan" && draft.stock === "green") rows.push({key:"stock",label:"В наличии · Зелёный угол"});
    draft.model.split("|").filter(Boolean).forEach(model => rows.push({key:`model:${model}`,label:model}));
    if (draft.stock!=="green") filterSelections(draft.market).forEach(market => rows.push({ key: `market:${market}`, label: optionLabel(markets, market) }));
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
    if (key.startsWith("market:")) return setField("market", filterSelections(draft.market).filter(market => market !== key.slice(7)).join("|"));
    if (key.startsWith("model:")) return setDraft(current => ({...current,model:current.model.split("|").filter(model => model !== key.slice(6)).join("|")}));
    if (key.startsWith("auctionGrade:")) return setDraft(current => ({...current, auctionGrade: auctionGradeSelections(current.auctionGrade).filter(grade => grade !== key.slice(13)).join("|")}));
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
  const changeCity = (city: string) => {
    persistCity(city);
    // A city selection can supersede an in-flight Next navigation. Re-submit
    // the full current draft instead of letting the old URL win that race.
    const nextQuery = catalogQuery(draft, sortKey, sortDirection);
    submitted.current = nextQuery;
    const query = new URLSearchParams(nextQuery);if(initial.source&&draft.market===initial.market)query.set('source',initial.source);
    if (city) query.set("city", city);
    const current = new URLSearchParams(window.location.search);if(current.get("selection")==="1")query.set("selection","1");
    for (const key of ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","yclid"]) {
      const value = current.get(key); if (value) query.set(key,value);
    }
    const basePath = draft.market === "japan" && draft.stock === "green" ? "/cars/green" : "/cars";
    const href=dealerBrowsingHref(query.size ? `${basePath}?${query}` : basePath,dealer);
    rememberFilterScroll(href);
    startTransition(() => router.push(href, {scroll:false}));
  };
  const setElectric = (value: string) => { setField("fuel", value); };
  const chooseSort = (key: SortKey, direction: SortDir) => {
    setSortKey(key);
    setSortDirection(direction);
  };

  return <><CatalogFilterUiEnhancer />
    <CatalogFilterPending pending={updating}/>
    <form data-no-route-loader="true" aria-busy={updating} method="get" onSubmit={(event) => event.preventDefault()} className="ac-catalog-filter-panel mt-6 hidden lg:block">
      <div className="mb-2.5"><CatalogCityFilter onChange={changeCity} /></div>
      <div className="grid grid-cols-3 gap-2.5">
        <CatalogBrandMultiSelect value={draft.make} options={makeOptions} contextQuery={brandStatsContext} onChange={(value) => { setField("make", value); setField("model", ""); }} />
        <VehicleModelSearch multiple sourceItems={sourceModels} contextQuery={brandStatsContext} value={draft.model} make={draft.make} onMakeChange={(value) => setField("make", value)} onValueChange={(value) => setField("model", value)} />
        <SimpleSelect name="market" value={draft.market==="japan"&&draft.stock==="green"?"green":draft.market} placeholder="Все рынки" options={marketOptions} onChange={(value) => setField("market", value)} />
      </div>
      <div className={`ac-filter-quick-row mt-2.5 grid grid-cols-4 items-center gap-2.5`}>
        {<PowerLimitCheckbox sourcePower={draft.stock === "green"} checked={draft.powerTo === "160"} onChange={(checked) => setField("powerTo", checked ? "160" : "")} />}
        <ElectricCheckbox value={draft.fuel} onChange={setElectric} disabled={!interactive} />
        <div className="ac-sidebar-sort"><SortControl showAuctionDate={draft.market==="japan"&&draft.stock!=="green"} hidePrice={false} sortKey={sortKey} direction={sortDirection} onChange={chooseSort} /></div>
        <button type="button" disabled={!interactive} aria-busy={!interactive} onClick={() => setExpanded((current) => !current)} className={`ac-filter-settings relative flex h-13 min-w-0 items-center justify-center gap-2 rounded-[15px] px-3 text-xs font-black ${expanded ? "is-active" : ""}`} aria-label="Расширенные фильтры" aria-expanded={expanded}><SlidersIcon /><span className="whitespace-nowrap">{expanded ? "Скрыть" : "Ещё фильтры"}</span></button>
      </div>
      <section className="ac-advanced-fields mt-3"><AdvancedFields sourceModels={sourceModels} auctionResults={auctionResults} draft={draft} setField={setField} makeOptions={makeOptions} marketOptions={marketOptions} bodyOptions={bodyOptions} transmissionOptions={transmissionOptions} fuelOptions={fuelOptions} driveOptions={driveOptions} brandStatsContext={brandStatsContext} includeFuel /></section>
      <CatalogDesktopSelection><FilterChips chips={chips} onRemove={removeFilter} /></CatalogDesktopSelection>
      <p aria-hidden="true" className="h-4 text-xs text-[var(--ac-muted)]">{updating ? "Обновляем результаты…" : ""}</p>
    </form>

    <button type="button" disabled={!interactive} aria-busy={!interactive} onClick={() => setMobileOpen(true)} className="ac-filter-more-button mt-5 flex h-14 w-full items-center justify-between rounded-2xl px-4 text-sm font-black lg:hidden" aria-label="Открыть фильтры"><span className="flex items-center gap-2"><span>{updating ? "Обновляем…" : "Фильтры"}</span>{chips.length ? <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] text-white">{chips.length}</span> : null}</span><SlidersIcon /></button>

    <StickyCatalogControls showAuctionDate={draft.market==="japan"&&draft.stock!=="green"} onOpenFilters={()=>{if(window.matchMedia("(max-width:1023px)").matches)setMobileOpen(true);else document.querySelector(".ac-catalog-filter-panel")?.scrollIntoView({block:"start",behavior:"smooth"});}} hidePrice={false} chips={chips} onRemove={removeFilter} sort={sortParam(sortKey,sortDirection)} onSort={value=>{const next=initialSort(value);setSortKey(next.key);setSortDirection(next.direction);}} hidden={mobileOpen}/>

    {mobileOpen ? createPortal(<div className="ac-mobile-filter-backdrop fixed inset-0 z-[10040] flex items-end bg-black/65 lg:hidden" onClick={() => setMobileOpen(false)}><form data-no-route-loader="true" aria-busy={updating} method="get" onSubmit={(event) => event.preventDefault()} role="dialog" aria-modal="true" aria-label="Фильтры каталога" className="ac-mobile-filter-sheet flex w-full max-h-[91dvh] flex-col overflow-hidden rounded-t-[30px] bg-[var(--ac-surface)] text-[var(--ac-text)]" onClick={(event) => event.stopPropagation()}>
      <div className="ac-mobile-filter-header shrink-0 px-4 pt-1"><div className="mx-auto h-1 w-10 rounded-full bg-[var(--ac-muted)]/35" /><div className="flex items-center justify-between gap-2 py-2"><div className="min-w-0 flex items-center gap-2" role="status" aria-live="polite" aria-busy={updating}><span className="ac-pulse-dot ac-pulse-dot--status shrink-0" aria-hidden="true"><span /></span><span className="text-sm font-black tabular-nums">{updating ? "Обновляем…" : typeof resultCount === "number" ? `Найдено: ${resultCount.toLocaleString("ru-RU")}` : "Каталог"}</span></div><button type="button" data-ac-react-close="1" data-ac-mobile-close="1" onClick={() => setMobileOpen(false)} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ac-surface-2)] text-2xl ${chips.length || sortKey ? "ac-mobile-apply" : ""}`} aria-label={chips.length || sortKey ? "Применить фильтры" : "Закрыть"}>{chips.length || sortKey ? "ОК" : "×"}</button></div></div>
      <div className="ac-hide-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
        <section className="ac-mobile-filter-section"><CatalogCityFilter onChange={changeCity} /></section>
        {chips.length ? <section className="mb-4"><div className="mb-2 text-[10px] font-black normal-case tracking-normal text-[var(--ac-muted)]">Выбрано</div><FilterChips chips={chips} onRemove={removeFilter} compact /></section> : null}
        <section className="ac-mobile-filter-section"><div className="ac-mobile-filter-section__title">Сортировка</div><div className="ac-sidebar-sort"><SortControl showAuctionDate={draft.market==="japan"&&draft.stock!=="green"} hidePrice={false} sortKey={sortKey} direction={sortDirection} onChange={chooseSort} /></div></section>
        <section className="ac-mobile-filter-section"><div className="ac-mobile-filter-section__title">Быстрые параметры</div><div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"><ElectricCheckbox value={draft.fuel} onChange={setElectric} disabled={!interactive} />{<PowerLimitCheckbox sourcePower={draft.stock === "green"} checked={draft.powerTo === "160"} onChange={(checked) => setField("powerTo", checked ? "160" : "")} />}</div></section>
        <section className="ac-mobile-filter-section"><div className="ac-mobile-filter-section__title">Автомобиль</div><AdvancedFields sourceModels={sourceModels} auctionResults={auctionResults} draft={draft} setField={setField} makeOptions={makeOptions} marketOptions={marketOptions} bodyOptions={bodyOptions} transmissionOptions={transmissionOptions} fuelOptions={fuelOptions} driveOptions={driveOptions} brandStatsContext={brandStatsContext} includePrimary includeFuel /></section>
      </div>
      <div className="shrink-0 border-t border-[var(--ac-border)] bg-[var(--ac-surface)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <button type="button" data-ac-react-close="1" onClick={() => setMobileOpen(false)} className="min-h-12 w-full rounded-2xl bg-red-500 px-4 text-sm font-black text-white">Показать автомобили</button>
      </div>
    </form></div>, document.body) : null}

    <style jsx global>{`
      .ac-sort-control,.ac-filter-settings,.ac-filter-reset,.ac-range-card,.ac-filter-chip{background:var(--ac-surface-2);color:var(--ac-text);border:1px solid var(--ac-border)}
      .ac-sort-control>button+button{border-left:1px solid var(--ac-border)}
      .ac-sort-control button{color:var(--ac-muted);transition:background-color .16s ease,color .16s ease}
      .ac-sort-control button.is-active{background:#ff353d;color:#fff}
      .ac-sort-direction:disabled{opacity:.35;cursor:not-allowed}
      .ac-filter-settings{transition:background-color .16s ease,color .16s ease,transform .16s ease}
      .ac-filter-settings:hover,.ac-filter-settings.is-active{background:var(--ac-surface-3);color:#ff353d}
      .ac-filter-settings:active{transform:scale(.98)}
      .ac-advanced-fields{background:transparent}
      .ac-range-fields-shell{background:transparent;border:0;padding:0}
      .ac-range-card{background:var(--ac-surface)}
      .ac-filter-chip{background:var(--ac-surface-2)}
      .ac-filter-chip:hover{background:var(--ac-surface-3)}
      .ac-filter-count-badge{background:#ff353d!important;color:#fff!important;-webkit-text-fill-color:#fff!important}
      .ac-range-clear,.ac-range-preset{background:var(--ac-surface-2);border:1px solid var(--ac-border);transition:background-color .15s ease,color .15s ease,border-color .15s ease}
      .ac-range-clear:hover,.ac-range-preset:hover{background:var(--ac-surface-3);color:var(--ac-text);border-color:rgba(255,53,61,.35)}
      .ac-range-input-wrap{display:block;min-width:0}
      .ac-range-input-wrap>span{display:block;margin:0 0 5px 2px;font-size:10px;font-weight:900;letter-spacing:normal;text-transform:none;color:var(--ac-muted)}
      .ac-range-input-box{display:flex;align-items:center;min-width:0;height:42px;border-radius:12px;background:var(--ac-surface-2);border:1px solid var(--ac-border);overflow:hidden;transition:border-color .15s ease,background-color .15s ease}
      .ac-range-input-box:focus-within{border-color:rgba(255,53,61,.72);background:var(--ac-surface-3)}
      .ac-range-input-box input{min-width:0;width:100%;height:100%;padding:0 10px;background:transparent!important;border:0!important;outline:0!important;color:var(--ac-text)!important;font-size:13px;font-weight:900;box-shadow:none!important}
      .ac-range-input-box input::placeholder{color:var(--ac-muted);opacity:.72;font-weight:700}
      .ac-range-input-box small{flex:none;padding-right:9px;color:var(--ac-muted);font-size:10px;font-weight:800;white-space:nowrap}
      .ac-range-preset{color:var(--ac-muted)}
      .ac-mobile-filter-section{margin-top:16px;padding:0;background:transparent}
      .ac-mobile-filter-section__title{margin:0 0 9px;font-size:10px;font-weight:900;letter-spacing:normal;text-transform:none;color:var(--ac-muted)}
      @media(max-width:1023px){
        .ac-mobile-filter-sheet .ac-filter-control,.ac-mobile-filter-sheet .ac-sort-control{min-height:52px;height:52px;border-radius:15px}
        .ac-mobile-filter-sheet .ac-filter-dropdown{position:static!important;max-height:none!important;inset:auto!important;margin-top:6px;background:var(--ac-surface-3);box-shadow:none!important;border:1px solid var(--ac-border)!important}
        .ac-mobile-filter-sheet .relative:has(>.ac-filter-dropdown){z-index:auto!important}
        .ac-mobile-filter-sheet .ac-filter-dropdown .ac-filter-option{background:transparent}
        .ac-mobile-filter-sheet .ac-filter-dropdown .ac-filter-option.is-active{background:rgba(255,53,61,.12);color:#ff5962}
        .ac-mobile-filter-sheet .ac-advanced-fields{background:transparent}
        .ac-mobile-filter-sheet .ac-range-fields-shell{background:transparent;border:0;border-radius:0;padding:0}
        .ac-mobile-filter-sheet .ac-range-card{background:var(--ac-surface)}
      }
      html[data-theme="light"] .ac-mobile-filter-sheet {color:var(--ac-text)!important}
      html[data-theme="light"] .ac-mobile-filter-sheet [class*="border-white/"]{border-color:rgba(30,36,48,.09)!important}
    `}</style>
  </>;
}

function CatalogCityFilter({onChange}:{onChange:(city:string)=>void}) {
 const city=useSelectedCity(),[open,setOpen]=useState(false);
 return <div className="ac-catalog-city-filter min-w-0"><button type="button" className="ac-filter-control flex h-13 w-full min-w-0 items-center justify-between gap-2 rounded-[15px] px-4 text-left text-sm font-black" aria-label={`Выбрать город. Сейчас: ${city || "не выбран"}`} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><span className="flex min-w-0 items-center gap-2"><LocationIcon className="h-5 w-5 shrink-0 text-[#ff353d]"/><span className="truncate">{city || "Выбрать город"}</span></span><Chevron /></button>{open&&<CityPickerDialog persistSelection={false} onChange={onChange} onClose={()=>setOpen(false)}/>}</div>;
}
