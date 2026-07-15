"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Option = { value: string; label: string };

type Props = {
  initial: Record<string, string>;
  makes: string[];
  modelsByMake: Record<string, string[]>;
};

const markets: Option[] = [
  { value: "", label: "Все рынки" },
  { value: "korea", label: "Корея" },
  { value: "china", label: "Китай" },
  { value: "japan", label: "Япония" },
  { value: "uae", label: "ОАЭ" },
  { value: "europe", label: "Европа" },
];

function Chevron() {
  return <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function SearchIcon() {
  return <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.7" /><path d="M12 12L16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function SearchSelect({ value, onChange, options, placeholder, searchPlaceholder }: { value: string; onChange: (value: string) => void; options: Option[]; placeholder: string; searchPlaceholder: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = options.find((item) => item.value === value);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    if (!normalized) return options;
    return options.filter((item) => item.label.toLocaleLowerCase("ru-RU").includes(normalized));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  function select(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className={`relative min-w-0 ${open ? "z-[190]" : "z-0"}`}>
      <button type="button" onClick={() => setOpen((current) => !current)} className={`ac-search-select soft-input flex h-13 w-full min-w-0 items-center justify-between gap-2 rounded-2xl px-4 text-left text-sm font-black transition md:h-14 ${open ? "rounded-b-none ring-2 ring-red-500/35" : ""}`} aria-expanded={open} aria-haspopup="listbox">
        <span className={`min-w-0 truncate ${selected?.value ? "text-white" : "text-white/68"}`}>{selected?.label || placeholder}</span>
        <span className={`shrink-0 text-white/46 transition ${open ? "rotate-180" : ""}`}><Chevron /></span>
      </button>

      {open ? (
        <div className="ac-search-menu absolute left-0 right-0 top-[calc(100%-1px)] z-[190] overflow-hidden rounded-b-2xl bg-[#171922] shadow-[0_24px_80px_rgba(0,0,0,.72)]">
          <div className="p-2.5">
            <div className="ac-search-box flex h-10 items-center gap-2 rounded-xl bg-white/[0.065] px-3 text-white/45 ring-1 ring-white/10 focus-within:ring-red-400/55">
              <SearchIcon />
              <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} className="min-w-0 flex-1 bg-transparent text-sm font-bold text-white outline-none placeholder:text-white/28" />
              {query ? <button type="button" onClick={() => setQuery("")} className="flex h-6 w-6 items-center justify-center rounded-full text-white/45 hover:bg-white/10 hover:text-white" aria-label="Очистить поиск">×</button> : null}
            </div>
          </div>
          <div className="ac-hide-scrollbar max-h-[270px] overflow-y-auto overscroll-contain p-1.5 pt-0" role="listbox">
            {filtered.length ? filtered.map((item) => {
              const active = item.value === value;
              return (
                <button key={item.value || "any"} type="button" role="option" aria-selected={active} onClick={() => select(item.value)} className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-bold transition ${active ? "bg-red-500 text-white" : "text-white/78 hover:bg-white/[0.07] hover:text-white"}`}>
                  <span className="min-w-0 truncate">{item.label}</span>
                  {active ? <svg width="15" height="12" viewBox="0 0 15 12" fill="none" aria-hidden="true"><path d="M1.5 6.2L5.2 10L13.5 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
                </button>
              );
            }) : <div className="px-3 py-6 text-center text-sm font-bold text-white/40">Ничего не найдено</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NativeSelect({ name, defaultValue, children, ariaLabel }: { name: string; defaultValue?: string; children: React.ReactNode; ariaLabel: string }) {
  return (
    <label className="relative min-w-0">
      <span className="sr-only">{ariaLabel}</span>
      <select name={name} defaultValue={defaultValue} className="ac-native-select soft-input h-13 w-full rounded-2xl px-4 text-sm font-bold text-white outline-none md:h-14">
        {children}
      </select>
    </label>
  );
}

export function CatalogFilterForm({ initial, makes, modelsByMake }: Props) {
  const [market, setMarket] = useState(initial.market || "");
  const [make, setMake] = useState(initial.make || "");
  const [model, setModel] = useState(initial.model || "");

  const makeOptions = useMemo<Option[]>(() => {
    const values = [...new Set([initial.make, ...makes].filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
    return [{ value: "", label: "Любая марка" }, ...values.map((value) => ({ value, label: value }))];
  }, [initial.make, makes]);

  const modelOptions = useMemo<Option[]>(() => {
    const allModels = make ? modelsByMake[make] || [] : Object.values(modelsByMake).flat();
    const values = [...new Set([initial.model, ...allModels].filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
    return [{ value: "", label: "Любая модель" }, ...values.map((value) => ({ value, label: value }))];
  }, [initial.model, make, modelsByMake]);

  return (
    <form method="get" className="ac-filter-panel mt-6 rounded-[1.7rem] p-3 md:p-4">
      <input type="hidden" name="market" value={market} />
      <input type="hidden" name="make" value={make} />
      <input type="hidden" name="model" value={model} />

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <input name="budget" defaultValue={initial.budget} inputMode="numeric" placeholder="Бюджет ₽" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl px-4 text-sm font-bold text-white outline-none md:h-14" />
        <SearchSelect value={market} onChange={setMarket} options={markets} placeholder="Все рынки" searchPlaceholder="Найти рынок" />
        <SearchSelect value={make} onChange={(next) => { setMake(next); setModel(""); }} options={makeOptions} placeholder="Любая марка" searchPlaceholder="Найти марку" />
        <SearchSelect value={model} onChange={setModel} options={modelOptions} placeholder="Любая модель" searchPlaceholder="Найти модель" />
        <button className="avto-button col-span-2 h-13 rounded-2xl px-7 text-base font-black md:h-14 lg:col-span-1">Показать</button>
      </div>

      <details className="ac-filter-more mt-3 rounded-2xl bg-black/12 px-3 py-2.5">
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-1 text-sm font-black text-white/62">
          <span>Дополнительные фильтры</span>
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.045] text-red-300" aria-hidden="true"><Chevron /></span>
        </summary>

        <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-6">
          <input name="yearFrom" defaultValue={initial.yearFrom} inputMode="numeric" placeholder="Год от" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl px-4 text-sm font-bold text-white outline-none" />
          <NativeSelect name="hasPrice" defaultValue={initial.hasPrice} ariaLabel="Наличие цены">
            <option value="">С ценой и без</option>
            <option value="yes">Только с ценой</option>
            <option value="no">Цена уточняется</option>
          </NativeSelect>
          <NativeSelect name="bodyType" defaultValue={initial.bodyType} ariaLabel="Кузов">
            <option value="">Любой кузов</option><option value="suv">Кроссовер</option><option value="offroad">Внедорожник</option><option value="sedan">Седан</option><option value="hatchback">Хэтчбек</option><option value="wagon">Универсал</option><option value="minivan">Минивэн</option><option value="coupe">Купе</option><option value="pickup">Пикап</option>
          </NativeSelect>
          <input name="mileageTo" defaultValue={initial.mileageTo} inputMode="numeric" placeholder="Пробег до" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl px-4 text-sm font-bold text-white outline-none" />
          <input name="engineFrom" defaultValue={initial.engineFrom} inputMode="numeric" placeholder="Двигатель от" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl px-4 text-sm font-bold text-white outline-none" />
          <input name="powerFrom" defaultValue={initial.powerFrom} inputMode="numeric" placeholder="Мощность от" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl px-4 text-sm font-bold text-white outline-none" />
          <input name="fuel" defaultValue={initial.fuel} placeholder="Топливо" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl px-4 text-sm font-bold text-white outline-none" />
          <input name="drive" defaultValue={initial.drive} placeholder="Привод" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl px-4 text-sm font-bold text-white outline-none" />
        </div>
      </details>
    </form>
  );
}
