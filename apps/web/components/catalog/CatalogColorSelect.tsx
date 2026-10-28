"use client";
import {useEffect,useRef,useState} from 'react';
import {namedVehicleColor,vehicleColorHex} from '@/lib/catalog/vehicle-colors';
function Swatch({value}:{value:string}){
 const background=namedVehicleColor(value)?.[1]||vehicleColorHex(value);
 return background?<span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border border-[var(--ac-border)]" style={{background}}/>:null;
}
export function CatalogColorSelect({value,market,stock,onChange}:{value:string;market:string;stock:string;onChange:(value:string)=>void}){
 const [open,setOpen]=useState(false),[colors,setColors]=useState<string[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(false),[partial,setPartial]=useState(false),[attempt,setAttempt]=useState(0);
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const controller=new AbortController();setLoading(true);setError(false);
 const query=new URLSearchParams({market,stock});
 fetch(`/api/catalog/colors?${query}`,{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error();const data=await response.json();if(!data.ok||!Array.isArray(data.colors))throw Error();setColors(data.colors);setPartial(Boolean(data.partial));}).catch(e=>{if(e.name!=='AbortError')setError(true);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
 return()=>controller.abort();},[open,market,stock,attempt]);
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopImmediatePropagation();setOpen(false);root.current?.querySelector<HTMLButtonElement>(':scope > button')?.focus();}};document.addEventListener('pointerdown',outside);window.addEventListener('keydown',escape,true);return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',escape,true);};},[open]);
 const choose=(color:string)=>{onChange(color);setOpen(false);};
 return <div ref={root} className={`ac-color-select relative min-w-0 ${open?'z-[240]':'z-0'}`}>
  <input type="hidden" name="color" value={value}/>
  <button type="button" aria-label={`Цвет: ${value||'Любой цвет'}`} aria-expanded={open} onClick={()=>setOpen(!open)} className="ac-filter-control flex h-13 w-full items-center gap-3 rounded-[15px] px-4 text-left text-sm font-black">{value?<Swatch value={value}/>:<span aria-hidden="true" className="ac-filter-color-spectrum"/>}<span className="min-w-0 flex-1 truncate">{value||'Цвет'}</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.8"/></svg></button>
  {open&&<div className="ac-filter-dropdown absolute bottom-[calc(100%+7px)] left-0 right-0 overflow-hidden rounded-2xl p-2">
   <div className="ac-hide-scrollbar max-h-64 overflow-y-auto" role="group" aria-label="Цвет автомобиля">
    <button type="button" aria-pressed={!value} onClick={()=>choose('')} className="ac-filter-option flex min-h-11 w-full items-center rounded-xl px-3 py-2 text-left text-sm font-bold">Любой цвет</button>
    {loading?<p role="status" className="px-3 py-2 text-sm">Загружаем цвета…</p>:error?<p role="status" className="px-3 py-2 text-sm">Не удалось получить цвета.</p>:colors.map(color=><button key={color} type="button" aria-pressed={value===color} onClick={()=>choose(color)} className={`ac-filter-option flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-bold ${value===color?'is-active':''}`}><Swatch value={color}/><span>{color}</span>{value===color&&<span className="ml-auto" aria-hidden="true">✓</span>}</button>)}
    {!loading&&!error&&!colors.length&&!partial&&<p className="px-3 py-2 text-sm">Цвета пока не указаны.</p>}
    {!loading&&(partial||error)&&<div className="px-3 py-2 text-sm">{!error&&<p>Часть цветов пока недоступна.</p>}<button type="button" onClick={()=>setAttempt(n=>n+1)} className="mt-1 underline">Повторить</button></div>}
   </div>
  </div>}
 </div>;
}
