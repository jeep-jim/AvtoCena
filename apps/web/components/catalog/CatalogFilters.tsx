"use client";

import { useMemo, useRef, useState, useEffect } from "react";

const makes = ["", "Toyota", "Honda", "Hyundai", "Kia", "Chevrolet", "Mercedes-Benz", "BMW", "Audi", "Lexus", "Genesis", "KGM", "Chery", "Geely", "Haval", "Volkswagen", "Nissan", "Mazda"];
const modelsByMake: Record<string, string[]> = {
  Toyota: ["", "Camry", "Corolla", "Harrier", "RAV4", "Land Cruiser", "Veloz"],
  Honda: ["", "Fit", "Vezel", "Stepwgn", "Freed", "Civic"],
  Hyundai: ["", "Casper", "Palisade", "Staria", "Sonata", "Santa Fe"],
  Kia: ["", "K3", "Ray", "Carnival", "Sorento", "Seltos"],
  Chevrolet: ["", "Spark", "Trailblazer"],
  Chery: ["", "Tiggo 7", "Tiggo 8"],
};

type Option = { value: string; label: string };

function Chevron({ open = false }: { open?: boolean }) {
  return <svg className={`shrink-0 transition ${open ? "rotate-180" : ""}`} width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function SearchSelect({ name, value, options, placeholder, onChange }: { name: string; value: string; options: Option[]; placeholder: string; onChange?: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(value);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => options.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())), [options, query]);

  useEffect(() => {
    setSelected(value);
  }, [value]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const active = options.find((item) => item.value === selected);
  function choose(next: string) {
    setSelected(next);
    onChange?.(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={root} className={`relative min-w-0 ${open ? "z-50" : "z-0"}`}>
      <input type="hidden" name={name} value={selected} />
      <button type="button" onClick={() => setOpen((current) => !current)} className="ac-search-select soft-input flex h-13 w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-sm font-bold md:h-14" aria-expanded={open}>
        <span className="truncate">{active?.label || placeholder}</span><span className="text-current/45"><Chevron open={open} /></span>
      </button>
      {open ? <div className="ac-search-menu absolute left-0 right-0 top-[calc(100%+6px)] overflow-hidden rounded-2xl bg-[#171922] shadow-[0_20px_60px_rgba(0,0,0,.55)]">
        <div className="p-2"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="ac-search-box h-10 w-full rounded-xl bg-white/[0.07] px-3 text-sm font-bold text-white outline-none" /></div>
        <div className="ac-hide-scrollbar max-h-64 overflow-y-auto p-1.5 pt-0">
          {filtered.map((item) => <button key={item.value || "any"} type="button" onClick={() => choose(item.value)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${selected === item.value ? "bg-red-500 text-white" : "text-white/78 hover:bg-white/[0.06]"}`}><span>{item.label}</span>{selected === item.value ? <span>✓</span> : null}</button>)}
        </div>
      </div> : null}
    </div>
  );
}

export function CatalogFilters({ initial }: { initial: Record<string, string> }) {
  const [make, setMake] = useState(initial.make || "");

  useEffect(() => {
    setMake(initial.make || "");
  }, [initial.make]);

  const modelOptions = (modelsByMake[make] || [""]).map((value) => ({ value, label: value || "Любая модель" }));
  const makeOptions = makes.map((value) => ({ value, label: value || "Любая марка" }));

  return <form className="ac-filter-panel mt-6 rounded-[1.7rem] p-3 md:p-4">
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
      <input name="budget" defaultValue={initial.budget} inputMode="numeric" placeholder="Бюджет ₽" className="ac-filter-input soft-input h-13 min-w-0 rounded-2xl px-4 text-sm font-bold outline-none md:h-14" />
      <SearchSelect name="market" value={initial.market} placeholder="Все рынки" options={[{value:"",label:"Все рынки"},{value:"korea",label:"Корея"},{value:"china",label:"Китай"},{value:"japan",label:"Япония"},{value:"uae",label:"ОАЭ"},{value:"europe",label:"Европа"}]} />
      <SearchSelect name="make" value={make} placeholder="Марка" options={makeOptions} onChange={setMake} />
      <SearchSelect key={make} name="model" value={initial.model} placeholder="Модель" options={modelOptions} />
      <button className="avto-button col-span-2 h-13 rounded-2xl px-7 text-base font-black md:h-14 lg:col-span-1">Показать</button>
    </div>
    <details className="ac-filter-more group mt-3 rounded-2xl bg-black/12 px-3 py-2.5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-1 text-sm font-black"><span>Дополнительные фильтры</span><span className="text-current/45 group-open:rotate-180"><Chevron /></span></summary>
      <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-6">
        <input name="yearFrom" defaultValue={initial.yearFrom} inputMode="numeric" placeholder="Год от" className="ac-filter-input soft-input h-13 rounded-2xl px-4 text-sm font-bold outline-none" />
        <select name="hasPrice" defaultValue={initial.hasPrice} className="ac-native-select soft-input h-13 rounded-2xl px-4 text-sm font-bold"><option value="">С ценой и без</option><option value="yes">Только с ценой</option><option value="no">Цена уточняется</option></select>
        <select name="bodyType" defaultValue={initial.bodyType} className="ac-native-select soft-input h-13 rounded-2xl px-4 text-sm font-bold"><option value="">Любой кузов</option><option value="suv">Кроссовер</option><option value="offroad">Внедорожник</option><option value="sedan">Седан</option><option value="hatchback">Хэтчбек</option><option value="wagon">Универсал</option><option value="minivan">Минивэн</option><option value="coupe">Купе</option><option value="pickup">Пикап</option></select>
        <input name="mileageTo" defaultValue={initial.mileageTo} inputMode="numeric" placeholder="Пробег до" className="ac-filter-input soft-input h-13 rounded-2xl px-4 text-sm font-bold outline-none" />
        <input name="engineFrom" defaultValue={initial.engineFrom} inputMode="numeric" placeholder="Двигатель от" className="ac-filter-input soft-input h-13 rounded-2xl px-4 text-sm font-bold outline-none" />
        <input name="powerFrom" defaultValue={initial.powerFrom} inputMode="numeric" placeholder="Мощность от" className="ac-filter-input soft-input h-13 rounded-2xl px-4 text-sm font-bold outline-none" />
      </div>
    </details>
  </form>;
}
