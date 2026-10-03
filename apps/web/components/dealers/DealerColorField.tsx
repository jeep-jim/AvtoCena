"use client";
import {useState} from "react";
import {Check,ChevronDown} from "lucide-react";
import {PublicSheet} from "../ui/PublicSheet";
import {input} from "./DealerEditorFields";

const colors = [
 ["Белый","#ffffff"], ["Чёрный","#151515"], ["Серый","#81858b"],
 ["Серебристый","linear-gradient(135deg,#9299a1,#f0f3f7,#a5adb7)"],
 ["Красный","#cf292f"], ["Бордовый","#742333"], ["Синий","#2458ac"],
 ["Голубой","#79bce1"], ["Зелёный","#33794c"], ["Оливковый","#7a8046"],
 ["Жёлтый","#f2ce37"], ["Оранжевый","#ed8a2c"], ["Коричневый","#815338"],
 ["Бежевый","#d7c3a0"], ["Золотистый","linear-gradient(135deg,#af8842,#f2d88f,#b39148)"],
 ["Бронзовый","#a77447"], ["Фиолетовый","#8154a0"], ["Розовый","#e394af"],
 ["Перламутровый","linear-gradient(135deg,#faf5e9,#e0e9f2,#f6e6eb)"],
 ["Двухцветный","linear-gradient(135deg,#fff 50%,#20252b 50%)"],
] as const;
const key=(v:string)=>v.toLocaleLowerCase("ru-RU").replaceAll("ё","е").trim();
export function DealerColorField({value,onChange,invalid=false}:{value:string;onChange:(value:string)=>void;invalid?:boolean}){
 const [open,setOpen]=useState(false);
 const selected=colors.find(([name])=>key(name)===key(value));
 return <div className="grid min-w-0 gap-1 text-sm"><span>Цвет</span>
  <button type="button" aria-label="Цвет" aria-haspopup="dialog" aria-expanded={open} aria-invalid={invalid||undefined} className={`${input} flex items-center gap-2 text-left`} onClick={()=>setOpen(true)}>
   {selected&&<span aria-hidden className="h-5 w-5 shrink-0 rounded-full border border-black/20" style={{background:selected[1]}}/>}
   <span className="min-w-0 flex-1 truncate">{value||"Выберите цвет"}</span><ChevronDown size={16} className="shrink-0"/>
  </button>
  {open&&<PublicSheet title="Цвет автомобиля" maxWidth={520} onClose={()=>setOpen(false)}>
   <div className="p-4"><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
    {colors.map(([name,background])=><button key={name} type="button" aria-pressed={selected?.[0]===name} onClick={()=>{onChange(name);setOpen(false);}} className="flex min-h-12 min-w-0 items-center gap-2 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] px-2 py-3 text-left text-xs font-bold">
     <span aria-hidden className="h-7 w-7 shrink-0 rounded-full border border-black/20" style={{background}}/><span className="min-w-0 flex-1 break-words">{name}</span>{selected?.[0]===name&&<Check size={15} className="shrink-0 text-green-600"/>}
    </button>)}
   </div><label className="mt-4 grid gap-2 text-sm">Свой оттенок или заводское название<input className="min-h-11 w-full rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] px-3 text-[var(--ac-text)]" value={value} maxLength={120} onChange={e=>onChange(e.target.value)}/></label>
   <button type="button" className="mt-3 min-h-11 w-full rounded-xl bg-[var(--ac-surface-2)] font-bold" onClick={()=>setOpen(false)}>Готово</button></div>
  </PublicSheet>}
 </div>;
}
