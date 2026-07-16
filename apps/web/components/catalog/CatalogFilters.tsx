"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const makes = [
  "", "Toyota", "Honda", "Hyundai", "Kia", "Chevrolet", "Mercedes-Benz", "BMW", "Audi", "Lexus", "Genesis", "KGM",
  "Chery", "Geely", "Haval", "Volkswagen", "Nissan", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Volvo", "Porsche",
  "Ford", "Renault", "Peugeot", "Skoda", "BYD", "Changan", "GAC", "Zeekr", "Li Auto", "Nio", "XPeng", "Jetour",
];

const modelsByMake: Record<string, string[]> = {
  Toyota: ["", "Camry", "Corolla", "Harrier", "RAV4", "Land Cruiser", "Veloz", "Alphard", "Crown"],
  Honda: ["", "Fit", "Vezel", "Stepwgn", "Freed", "Civic", "Accord", "CR-V"],
  Hyundai: ["", "Casper", "Palisade", "Staria", "Sonata", "Santa Fe", "Tucson", "Avante"],
  Kia: ["", "K3", "K5", "Ray", "Carnival", "Sorento", "Seltos", "Sportage", "Stinger"],
  Chevrolet: ["", "Spark", "Trailblazer", "Malibu", "Tahoe"],
  Chery: ["", "Tiggo 4", "Tiggo 7", "Tiggo 8"],
  BMW: ["", "3 Series", "5 Series", "X1", "X3", "X5", "X7"],
  Audi: ["", "A3", "A4", "A6", "Q3", "Q5", "Q7"],
  Lexus: ["", "ES", "IS", "NX", "RX", "LX", "LM"],
  "Mercedes-Benz": ["", "A-Class", "C-Class", "E-Class", "S-Class", "GLA", "GLC", "GLE", "GLS"],
};

type Option = { value: string; label: string };

function Chevron({ open = false }: { open?: boolean }) {
  return <svg className={`shrink-0 transition ${open ? "rotate-180" : ""}`} width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function SlidersIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7H20M4 17H20M8 4V10M16 14V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="8" cy="7" r="2" fill="currentColor" /><circle cx="16" cy="17" r="2" fill="currentColor" /></svg>;
}

function SearchSelect({ name, value, options, placeholder, onChange, className = "" }: { name: string; value: string; options: Option[]; placeholder: string; onChange?: (value: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(value);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return normalized ? options.filter((item) => item.label.toLocaleLowerCase("ru-RU").includes(normalized)) : options;
  }, [options, query]);

  useEffect(() => setSelected(value), [value]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    requestAnimationFrame(() => search.current?.focus());
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); };
  }, [open]);

  const active = options.find((item) => item.value === selected);
  const choose = (next: string) => {
    setSelected(next);
    onChange?.(next);
    setOpen(false);
    setQuery("");
  };

  return <div ref={root} className={`relative min-w-0 ${open ? "z-[190]" : "z-0"} ${className}`}>
    <input type="hidden" name={name} value={selected} />
    <button type="button" onClick={() => setOpen((current) => !current)} className="ac-search-select soft-input flex h-14 w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-sm font-bold" aria-expanded={open}>
      <span className="truncate">{active?.label || placeholder}</span><span className="text-current/45"><Chevron open={open} /></span>
    </button>
    {open ? <div className="ac-search-menu absolute left-0 right-0 top-[calc(100%+6px)] overflow-hidden rounded-2xl bg-[#171922] shadow-[0_20px_60px_rgba(0,0,0,.55)]">
      <div className="p-2"><input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="ac-search-box h-10 w-full rounded-xl bg-white/[0.07] px-3 text-sm font-bold text-white outline-none placeholder:text-white/35" /></div>
      <div className="ac-hide-scrollbar max-h-64 overflow-y-auto p-1.5 pt-0">
        {filtered.length ? filtered.map((item) => <button key={item.value || "any"} type="button" onClick={() => choose(item.value)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${selected === item.value ? "bg-red-500 text-white" : "text-white/78 hover:bg-white/[0.06]"}`}><span>{item.label}</span>{selected === item.value ? <span>✓</span> : null}</button>) : <div className="px-3 py-5 text-center text-sm font-bold text-white/40">Ничего не найдено</div>}
      </div>
    </div> : null}
  </div>;
}

const markets: Option[] = [{ value: "", label: "Все рынки" }, { value: "korea", label: "Корея" }, { value: "china", label: "Китай" }, { value: "japan", label: "Япония" }, { value: "uae", label: "ОАЭ" }, { value: "europe", label: "Европа" }];
const bodies: Option[] = [{ value: "", label: "Любой кузов" }, { value: "suv", label: "Кроссовер" }, { value: "offroad", label: "Внедорожник" }, { value: "sedan", label: "Седан" }, { value: "hatchback", label: "Хэтчбек" }, { value: "wagon", label: "Универсал" }, { value: "minivan", label: "Минивэн" }, { value: "coupe", label: "Купе" }, { value: "pickup", label: "Пикап" }];
const fuels: Option[] = [{ value: "", label: "Любое топливо" }, { value: "petrol", label: "Бензин" }, { value: "diesel", label: "Дизель" }, { value: "hybrid", label: "Гибрид" }, { value: "electric", label: "Электро" }, { value: "lpg", label: "Газ" }];
const transmissions: Option[] = [{ value: "", label: "Любая трансмиссия" }, { value: "automatic", label: "Автомат" }, { value: "manual", label: "Механика" }, { value: "cvt", label: "Вариатор" }, { value: "dct", label: "Робот" }];
const drives: Option[] = [{ value: "", label: "Любой привод" }, { value: "fwd", label: "Передний" }, { value: "rwd", label: "Задний" }, { value: "awd", label: "Полный" }];

function RangeFields({ fromName, toName, fromValue, toValue, fromPlaceholder, toPlaceholder, inputMode = "numeric" }: { fromName: string; toName: string; fromValue?: string; toValue?: string; fromPlaceholder: string; toPlaceholder: string; inputMode?: "numeric" | "decimal" }) {
  return <div className="grid grid-cols-2 overflow-hidden rounded-2xl bg-[var(--ac-surface-2)]">
    <input name={fromName} defaultValue={fromValue} inputMode={inputMode} placeholder={fromPlaceholder} className="ac-filter-input h-14 min-w-0 bg-transparent px-4 text-sm font-bold outline-none" />
    <input name={toName} defaultValue={toValue} inputMode={inputMode} placeholder={toPlaceholder} className="ac-filter-input h-14 min-w-0 bg-transparent px-4 text-sm font-bold outline-none" />
  </div>;
}

function AdvancedFields({ initial, make, setMake, includePrimary = true }: { initial: Record<string, string>; make: string; setMake: (value: string) => void; includePrimary?: boolean }) {
  const makeOptions = makes.map((value) => ({ value, label: value || "Любая марка" }));
  const modelOptions = (modelsByMake[make] || [""]).map((value) => ({ value, label: value || "Любая модель" }));
  return <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
    {includePrimary ? <>
      <SearchSelect name="make" value={make} placeholder="Марка" options={makeOptions} onChange={setMake} />
      <SearchSelect key={make} name="model" value={initial.model || ""} placeholder="Модель" options={modelOptions} />
      <SearchSelect name="market" value={initial.market || ""} placeholder="Рынок" options={markets} />
    </> : null}
    <SearchSelect name="bodyType" value={initial.bodyType || ""} placeholder="Кузов" options={bodies} />
    <SearchSelect name="transmission" value={initial.transmission || ""} placeholder="Трансмиссия" options={transmissions} />
    <RangeFields fromName="yearFrom" toName="yearTo" fromValue={initial.yearFrom} toValue={initial.yearTo} fromPlaceholder="Год от" toPlaceholder="до" />
    <RangeFields fromName="budgetFrom" toName="budget" fromValue={initial.budgetFrom} toValue={initial.budget} fromPlaceholder="Цена от, ₽" toPlaceholder="до" />
    <RangeFields fromName="mileageFrom" toName="mileageTo" fromValue={initial.mileageFrom} toValue={initial.mileageTo} fromPlaceholder="Пробег от, км" toPlaceholder="до" />
    <RangeFields fromName="engineFrom" toName="engineTo" fromValue={initial.engineFrom} toValue={initial.engineTo} fromPlaceholder="Объём от, см³" toPlaceholder="до" />
    <SearchSelect name="fuel" value={initial.fuel || ""} placeholder="Топливо" options={fuels} />
    <SearchSelect name="drive" value={initial.drive || ""} placeholder="Привод" options={drives} />
    <select name="hasPrice" defaultValue={initial.hasPrice || ""} className="ac-native-select soft-input h-14 rounded-2xl px-4 text-sm font-bold"><option value="">С ценой и без</option><option value="yes">Только с ценой</option><option value="no">Цена уточняется</option></select>
  </div>;
}

export function CatalogFilters({ initial }: { initial: Record<string, string> }) {
  const [make, setMake] = useState(initial.make || "");
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const makeOptions = makes.map((value) => ({ value, label: value || "Марка" }));
  const modelOptions = (modelsByMake[make] || [""]).map((value) => ({ value, label: value || "Модель" }));

  useEffect(() => setMake(initial.make || ""), [initial.make]);
  useEffect(() => {
    if (!mobileOpen) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = old; };
  }, [mobileOpen]);

  return <>
    <form className="ac-filter-panel mt-6 rounded-[1.7rem] p-3 md:p-4">
      <div className="hidden gap-3 lg:grid lg:grid-cols-[1fr_1fr_1fr_auto]">
        <SearchSelect name="make" value={make} placeholder="Марка" options={makeOptions} onChange={setMake} />
        <SearchSelect key={`desktop-${make}`} name="model" value={initial.model || ""} placeholder="Модель" options={modelOptions} />
        <SearchSelect name="market" value={initial.market || ""} placeholder="Все рынки" options={markets} />
        <button className="avto-button h-14 rounded-2xl px-12 text-base font-black">Найти</button>
      </div>
      <button type="button" onClick={() => setExpanded((current) => !current)} className="mx-auto mt-5 hidden items-center gap-2 text-sm font-bold text-white/42 transition hover:text-white lg:flex">Расширенный поиск <span className="text-base">→</span></button>
      {expanded ? <div className="mt-5 hidden lg:block"><AdvancedFields initial={initial} make={make} setMake={setMake} includePrimary={false} /><button className="avto-button mt-4 h-14 w-full rounded-2xl text-base font-black">Найти</button></div> : null}

      <div className="grid gap-3 lg:hidden">
        <SearchSelect name="make" value={make} placeholder="Марка" options={makeOptions} onChange={setMake} />
        <RangeFields fromName="yearFrom" toName="yearTo" fromValue={initial.yearFrom} toValue={initial.yearTo} fromPlaceholder="Год от" toPlaceholder="до" />
        <div className="grid grid-cols-[minmax(0,1fr)_58px] overflow-hidden rounded-2xl">
          <button className="avto-button h-14 rounded-none text-base font-black">Найти</button>
          <button type="button" onClick={() => setMobileOpen(true)} className="flex h-14 items-center justify-center bg-[var(--ac-surface-2)] text-[var(--ac-muted)]" aria-label="Открыть фильтры"><SlidersIcon /></button>
        </div>
      </div>
    </form>

    {mobileOpen ? <div className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)}>
      <form className="ac-hide-scrollbar absolute inset-y-0 right-0 w-[min(92vw,390px)] overflow-y-auto bg-[#14151b] p-5 pb-8 text-white shadow-[-24px_0_80px_rgba(0,0,0,.55)]" onClick={(event) => event.stopPropagation()}>
        <div className="mb-6 flex items-center justify-between"><h2 className="text-2xl font-black">Фильтры</h2><button type="button" onClick={() => setMobileOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] text-2xl text-white/60" aria-label="Закрыть">×</button></div>
        <AdvancedFields initial={initial} make={make} setMake={setMake} />
        <button className="avto-button mt-8 h-14 w-full rounded-2xl text-base font-black">Показать результаты</button>
      </form>
    </div> : null}
  </>;
}
