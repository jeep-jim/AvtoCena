"use client";
import {useState} from 'react';
import {Check,ChevronDown} from 'lucide-react';
import {PublicSheet} from '../ui/PublicSheet';
import {vehicleColors,namedVehicleColor,vehicleColorHex,hsvToHex,hexToHsv,nearestVehicleColor} from '@/lib/catalog/vehicle-colors';
import './dealer-color-field.css';
export function DealerColorField({value,onChange,invalid=false,maxLength=120,placeholder='Выберите цвет',resetLabel}:{value:string;onChange:(value:string)=>void;invalid?:boolean;maxLength?:number;placeholder?:string;resetLabel?:string}){
 const [open,setOpen]=useState(false),[palette,setPalette]=useState(false),[draft,setDraft]=useState(value),[hex,setHex]=useState('#2458ac'),[hsv,setHsv]=useState({h:217,s:79,v:67});
 const selected=namedVehicleColor(value),swatch=vehicleColorHex(value)||selected?.[1];
 function begin(){const color=vehicleColorHex(value)||'#2458ac';setHex(color);setHsv(hexToHsv(color));setDraft(value.replace(/\s*\(#[a-f0-9]{6}\)\s*$/i,''));setPalette(/\(#[a-f0-9]{6}\)\s*$/i.test(value));setOpen(true);}
 function pick(next:{h:number;s:number;v:number}){const color=hsvToHex(next.h,next.s,next.v);setHsv(next);setHex(color);setDraft(nearestVehicleColor(color));}
 function point(event:React.PointerEvent<HTMLDivElement>){const rect=event.currentTarget.getBoundingClientRect();pick({...hsv,s:Math.max(0,Math.min(100,(event.clientX-rect.left)/rect.width*100)),v:Math.max(0,Math.min(100,100-(event.clientY-rect.top)/rect.height*100))});}
 return <div className="grid min-w-0 gap-1 text-sm"><span>Цвет</span>
  <button type="button" aria-label="Цвет" aria-haspopup="dialog" aria-expanded={open} aria-invalid={invalid||undefined} className="soft-input flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm" onClick={begin}>
   {swatch&&<span aria-hidden className="h-5 w-5 shrink-0 rounded-full border border-black/20" style={{background:selected?.[1]||swatch}}/>}<span className="min-w-0 flex-1 truncate">{selected?.[0]||value.replace(/\s*\(#[a-f0-9]{6}\)\s*$/i,'')||placeholder}</span><ChevronDown size={16} className="shrink-0"/>
  </button>
  {open&&<PublicSheet title="Цвет автомобиля" maxWidth={520} className="ac-vehicle-color-sheet" onClose={()=>setOpen(false)}>
   <div className="p-4"><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
    {vehicleColors.map(([name,background])=><button key={name} type="button" aria-pressed={selected?.[0]===name&&!palette} onClick={()=>{onChange(name);setOpen(false);}} className="flex min-h-12 min-w-0 items-center gap-2 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] px-2 py-3 text-left text-xs font-bold"><span aria-hidden className="h-7 w-7 shrink-0 rounded-full border border-black/20" style={{background}}/><span className="min-w-0 flex-1 break-words">{name}</span>{selected?.[0]===name&&!palette&&<Check size={15} className="shrink-0 text-green-600"/>}</button>)}
    <button type="button" aria-expanded={palette} onClick={()=>setPalette(value=>!value)} className="flex min-h-12 items-center gap-2 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] px-2 py-3 text-left text-xs font-bold"><span className="ac-color-rainbow h-7 w-7 shrink-0 rounded-full" aria-hidden/>Вся палитра</button>
   </div>
   {palette&&<section className="mt-4 grid gap-3" aria-label="Спектр цвета">
    <div className="ac-color-spectrum" role="slider" tabIndex={0} aria-label="Насыщенность и яркость" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.s)} aria-valuetext={`Насыщенность ${Math.round(hsv.s)}%, яркость ${Math.round(hsv.v)}%`} style={{backgroundColor:hsvToHex(hsv.h,100,100)}} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);point(event);}} onPointerMove={event=>{if(event.buttons===1)point(event);}} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();pick({...hsv,s:Math.max(0,Math.min(100,hsv.s+(event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0))),v:Math.max(0,Math.min(100,hsv.v+(event.key==='ArrowUp'?1:event.key==='ArrowDown'?-1:0)))});}}><span style={{left:`${hsv.s}%`,top:`${100-hsv.v}%`,background:hex}}/></div>
    <label className="grid gap-1 text-sm">Цветовой тон<input className="ac-color-hue" type="range" min={0} max={359} value={hsv.h} onChange={event=>pick({...hsv,h:Number(event.target.value)})}/></label>
    <div className="flex items-end gap-3"><span className="h-11 w-11 shrink-0 rounded-xl border border-black/20" aria-label="Выбранный оттенок" style={{background:hex}}/><label className="grid min-w-0 flex-1 gap-1 text-sm">HEX<input value={hex} maxLength={7} className="min-h-11 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] px-3" onChange={event=>{const color=event.target.value;setHex(color);if(/^#[a-f0-9]{6}$/i.test(color)){setHsv(hexToHsv(color));setDraft(nearestVehicleColor(color));}}}/></label></div>
    <p className="text-xs text-[var(--ac-muted)]">Название оттенка приблизительное — его можно изменить ниже. Точный цвет сохранится по HEX.</p>
   </section>}
   <label className="mt-4 grid gap-2 text-sm">Свой оттенок или заводское название<input className="min-h-11 w-full rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] px-3 text-[var(--ac-text)]" value={draft} maxLength={maxLength} onChange={event=>setDraft(event.target.value)}/></label>
   <button type="button" disabled={palette&&!/^#[a-f0-9]{6}$/i.test(hex)} className="mt-3 min-h-11 w-full rounded-xl bg-[var(--ac-surface-2)] font-bold disabled:opacity-40" onClick={()=>{const name=palette?draft.replace(/\s*\(#[a-f0-9]{6}\)\s*$/i,'').trim():draft;onChange(palette?`${name.slice(0,Math.max(0,maxLength-10))||nearestVehicleColor(hex)} (${hex.toLowerCase()})`:draft);setOpen(false);}}>Готово</button>
   {resetLabel&&<button type="button" className="mt-2 min-h-10 w-full rounded-xl text-sm font-bold" onClick={()=>{onChange('');setOpen(false);}}>{resetLabel}</button>}
   </div>
  </PublicSheet>}
 </div>;
}
