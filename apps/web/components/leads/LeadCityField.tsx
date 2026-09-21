"use client";
import { useRef, useState } from "react";
import { CityPickerDialog, LocationIcon, persistCity, useCitySuggestions } from "../home/CitySelector";

export function LeadCityField({value,onChange}:{value:string;onChange:(city:string)=>void}) {
  const [open,setOpen]=useState(false);
  const [focused,setFocused]=useState(false);
  const trigger=useRef<HTMLButtonElement>(null);
  const {suggestions}=useCitySuggestions(value);
  const choose=(city:string)=>{onChange(city);persistCity(city);setFocused(false);};
  return <div className="relative" data-native-city-field>
    <button ref={trigger} type="button" aria-label={`Выбрать город. Сейчас: ${value||"не выбран"}`} onClick={()=>setOpen(true)} className="soft-input flex h-[52px] w-full items-center justify-between gap-3 rounded-2xl bg-[var(--ac-surface-2)] px-4 text-left md:hidden"><span className={value?"":"text-[var(--ac-muted)]"}>{value||"Выберите город"}</span><LocationIcon className="h-6 w-6 shrink-0 text-red-500"/></button>
    <div className="relative hidden md:block">
      <input data-native-city value={value} onChange={event=>onChange(event.target.value)} onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)} aria-label="Ваш город" autoComplete="address-level2" placeholder="Например, Москва" className="soft-input h-[52px] w-full rounded-2xl bg-[var(--ac-surface-2)] pl-4 pr-14 outline-none"/>
      <button type="button" onClick={()=>{setFocused(false);setOpen(true);}} aria-label="Открыть выбор города" className="absolute right-0 top-0 flex h-[52px] w-12 items-center justify-center text-red-500"><LocationIcon className="h-6 w-6"/></button>
      {focused&&suggestions.length?<div className="absolute inset-x-0 top-full z-50 mt-2 max-h-60 overflow-y-auto rounded-2xl bg-[var(--ac-surface-3)] p-2 shadow-xl">{suggestions.map(item=><button type="button" key={item.value} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(item.value)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-[var(--ac-surface-2)]"><span className="font-bold">{item.city}</span><span className="text-xs text-[var(--ac-muted)]">{item.region}</span></button>)}</div>:null}
    </div>
    {open?<CityPickerDialog onChange={onChange} onClose={()=>{setOpen(false);trigger.current?.focus({preventScroll:true});}}/>:null}
  </div>;
}
