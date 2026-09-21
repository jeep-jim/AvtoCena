"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTapActivation } from "../catalog/useTapActivation";
import { createPortal } from "react-dom";
import { CITY_CHANGED_EVENT, readSelectedCity } from "../../lib/location/selected-city";
import type { searchRussianCities } from "../../lib/location/cities";

type Props = { value: string; syncStored?: boolean; onStoredChange?: (city: string) => void; triggerLabel?: string; onChange: (city: string) => void };
const POPULAR_CITIES = ["Москва", "Санкт-Петербург", "Новосибирск", "Екатеринбург", "Казань", "Красноярск", "Омск", "Самара", "Челябинск", "Ростов-на-Дону", "Уфа", "Новокузнецк", "Барнаул", "Иркутск", "Владивосток"];

export function LocationIcon({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s7-5.6 7-12A7 7 0 1 0 5 9c0 6.4 7 12 7 12Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="12" cy="9" r="2.6" stroke="currentColor" strokeWidth="2" /></svg>;
}
export function persistCity(city: string) {
  try { localStorage.setItem("avtocena_city", city); } catch {}
  document.cookie = `avtocena_city=${encodeURIComponent(city)}; Max-Age=15552000; Path=/; SameSite=Lax`;
  const url = new URL(window.location.href);
  if (city) url.searchParams.set("city", city); else url.searchParams.delete("city");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event(CITY_CHANGED_EVENT));
}
export function useCitySuggestions(query: string) {
  const [search, setSearch] = useState<typeof searchRussianCities | null>(null);
  useEffect(() => { let active=true; import("../../lib/location/cities").then(module=>{if(active)setSearch(()=>module.searchRussianCities);}).catch(()=>{});return()=>{active=false;}; },[]);
  const suggestions=useMemo(()=>query.trim().length>=2 && search ? search(query) : [],[query,search]);
  return {suggestions,loading:query.trim().length>=2 && !search};
}

export function CityPickerDialog({onChange,onClose}:{onChange:(city:string)=>void;onClose:()=>void}) {
  const [query,setQuery]=useState("");
  const {suggestions,loading}=useCitySuggestions(query);
  const [viewport,setViewport]=useState<{top:number;height:number}|null>(null);
  const panel=useRef<HTMLElement>(null);
  const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{
    const previous=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const update=()=>{const v=window.visualViewport;setViewport({top:v?.offsetTop||0,height:v?.height||window.innerHeight});};
    update();window.visualViewport?.addEventListener("resize",update);window.visualViewport?.addEventListener("scroll",update);window.addEventListener("resize",update);
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();event.stopImmediatePropagation();closeRef.current();}
      if(event.key==="Tab"){
        const controls=panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,a[href]');
        const first=controls?.[0],last=controls?.[controls.length-1];
        if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    window.addEventListener("keydown",keydown,true);
    return()=>{document.body.style.overflow=previous;window.removeEventListener("keydown",keydown,true);window.visualViewport?.removeEventListener("resize",update);window.visualViewport?.removeEventListener("scroll",update);window.removeEventListener("resize",update);};
  },[]);
  const choose=(city:string)=>{const normalized=city.trim().replace(/^г(?:\.\s*|\s+)/i,"");if(!normalized)return;persistCity(normalized);onChange(normalized);onClose();};
  const popular=POPULAR_CITIES.filter(city=>!query.trim()||city.toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU"))).slice(0,10);
  // Keep the keyboard open until click: blurring on pointer-down can move a
  // bottom sheet between pointer-down/up and swallow the very first selection.
  return createPortal(<div data-city-picker className="fixed inset-x-0 z-[25000] flex items-start justify-center bg-black/65 p-2 backdrop-blur-md md:items-center md:p-6" style={{top:viewport?.top||0,height:viewport?.height||"100dvh"}} onMouseDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();if(event.target===event.currentTarget)onClose();}}>
    <section ref={panel} role="dialog" aria-modal="true" aria-label="Выбор города" className="flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-[24px] bg-[var(--ac-surface)] p-4 text-[var(--ac-text)] shadow-2xl md:max-h-[90vh] md:p-6">
      <div className="flex shrink-0 items-center justify-between gap-3"><h2 className="text-xl font-black md:text-2xl">Куда привезти автомобиль?</h2><button type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ac-surface-2)] text-2xl" aria-label="Закрыть выбор города">×</button></div>
      <div className="relative mt-3 shrink-0"><LocationIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--ac-muted)]"/><input autoFocus aria-label="Поиск города" autoComplete="off" enterKeyHint="done" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();choose(suggestions[0]?.value||query);}}} placeholder="Начните вводить город" className="h-14 w-full rounded-2xl bg-[var(--ac-surface-2)] pl-12 pr-4 text-base font-bold outline-none"/></div>
      <div className="ac-hide-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-label="Подсказки городов">
        {loading?<p role="status" className="px-3 py-3 text-sm">Загружаем справочник…</p>:null}
        {suggestions.map(item=><button key={item.value} type="button" onPointerDown={event=>event.preventDefault()} onClick={() => choose(item.value)} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-[var(--ac-surface-2)]"><span className="min-w-0 font-black">{item.city}</span><span className="max-w-[45%] text-right text-xs text-[var(--ac-muted)]">{item.region}</span></button>)}
        {!suggestions.length&&!loading?<div className="grid grid-cols-2 gap-2">{popular.map(city=><button key={city} type="button" onPointerDown={event=>event.preventDefault()} onClick={() => choose(city)} className="min-h-12 rounded-xl bg-[var(--ac-surface-2)] px-3 py-3 text-left text-sm font-black">{city}</button>)}</div>:null}
        {query.trim().length>=2&&!loading&&!suggestions.length?<p className="mt-2 text-sm text-[var(--ac-muted)]">Город не найден. Можно сохранить название вручную; доставку уточним.</p>:null}
        <p className="mt-3 text-xs text-[var(--ac-muted)]">Справочник: <a href="https://github.com/hflabs/city" target="_blank" rel="noreferrer" className="underline">HFLabs / DaData</a>, CC BY-SA 4.0.</p>
        <button type="button" onPointerDown={event=>event.preventDefault()} onClick={()=>{persistCity("");onChange("");onClose();}} className="mt-2 min-h-11 w-full text-sm underline">Не выбирать город</button>
      </div>
      <button type="button" onPointerDown={event=>event.preventDefault()} onClick={()=>choose(suggestions.find(item=>item.city.toLocaleLowerCase("ru-RU")===query.trim().toLocaleLowerCase("ru-RU"))?.value||query)} disabled={!query.trim()} className="avto-button mt-3 min-h-12 shrink-0 rounded-2xl text-sm font-black disabled:opacity-45">Выбрать город</button>
    </section>
  </div>,document.body);
}

export function CitySelector({value,onChange,triggerLabel,onStoredChange,syncStored=true}:Props){
  const tap=useTapActivation();const [open,setOpen]=useState(false);const [mounted,setMounted]=useState(false);const trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{setMounted(true);if(syncStored){const stored=readSelectedCity();if(stored!==value)(onStoredChange||onChange)(stored);}},[]);
  useEffect(()=>{if(!syncStored)return;const sync=()=>(onStoredChange||onChange)(readSelectedCity());window.addEventListener(CITY_CHANGED_EVENT,sync);return()=>window.removeEventListener(CITY_CHANGED_EVENT,sync);},[onChange,onStoredChange,syncStored]);
  const label=value||"Ваш город";
  return <><span className={triggerLabel?"inline-flex":"ac-city-selector mt-2 flex w-fit max-w-full items-center text-[.74em] leading-none lg:mt-0 lg:inline-flex"}><button ref={trigger} type="button" {...tap} disabled={!mounted} onClick={()=>setOpen(true)} className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-[.13em] border-b-[.045em] border-dotted border-current px-[.08em] py-[.04em] text-left font-black text-[var(--ac-muted)] transition hover:text-[var(--ac-text)]" aria-label={`Выбрать город. Сейчас: ${label}`}><LocationIcon className="h-[.78em] w-[.78em] shrink-0 text-[#ff353d]"/><span className="truncate">{triggerLabel||label}</span></button></span>{mounted&&open?<CityPickerDialog onChange={onChange} onClose={()=>{setOpen(false);trigger.current?.focus({preventScroll:true});}}/>:null}</>;
}
