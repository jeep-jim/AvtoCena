'use client';
import {useEffect,useRef,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {CatalogMarketFlag} from '../catalog/CatalogMarketFlag';
import {AUTOCALC_MARKETS,VERIFIED_LINK_SOURCES} from '../../lib/autocalc/sources';

export function SourceDirectory(){
 const [market,setMarket]=useState<keyof typeof AUTOCALC_MARKETS>('uae'),[open,setOpen]=useState(false);
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[open]);
const sources=VERIFIED_LINK_SOURCES.filter(s=>s.market===market);
 return <details className="rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-4">
  <summary className="cursor-pointer text-sm font-bold">Проверенные источники по странам</summary>
  <div ref={root} className="relative mt-4" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}}}>
   <p className="mb-2 text-xs font-semibold">Где искать автомобиль</p>
   <button ref={trigger} type="button" aria-label={`Страна источников: ${AUTOCALC_MARKETS[market]}`} aria-expanded={open} aria-controls="autocalc-source-markets" onClick={()=>setOpen(!open)} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 text-left font-bold"><CatalogMarketFlag market={market}/><span className="flex-1">{AUTOCALC_MARKETS[market]}</span><ChevronDown size={18}/></button>
   {open?<div id="autocalc-source-markets" role="group" aria-label="Страна источников" className="absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-auto rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-1 shadow-xl">{Object.entries(AUTOCALC_MARKETS).map(([key,name])=><button key={key} type="button" aria-label={name} aria-pressed={market===key} onClick={()=>{setMarket(key as keyof typeof AUTOCALC_MARKETS);setOpen(false);trigger.current?.focus();}} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-bold hover:bg-[var(--ac-surface-2)] focus:bg-[var(--ac-surface-2)]"><CatalogMarketFlag market={key}/>{name}</button>)}</div>:null}
  </div>
  <div className="mt-3 space-y-2">{sources.map(s=><a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-between rounded-xl bg-[var(--ac-surface)] px-4 text-sm font-bold text-[var(--ac-text)]">{s.name}<span aria-hidden>↗</span></a>)}</div>
  <p className="mt-3 text-xs leading-5 text-[var(--ac-muted)]">{sources.length?'Загрузку карточек проверили 27 сентября. Откройте сайт, выберите автомобиль и вставьте ссылку на его объявление.':'Пока нет подтверждённого прямого источника для этого рынка. Выберите автомобиль в нашем каталоге или заполните характеристики вручную.'}</p>
  <a href={`/cars?market=${market}`} className="mt-3 inline-block text-sm font-semibold text-[var(--ac-text)] underline underline-offset-4">Автомобили из {({japan:'Японии',china:'Китая',korea:'Кореи',uae:'ОАЭ',europe:'Европы',georgia:'Грузии'} as Record<string,string>)[market]} в АвтоЦене →</a>
  <p className="mt-3 text-xs leading-5 text-[var(--ac-muted)]">Зарубежные сайты иногда отвечают медленно или временно ограничивают загрузку. Если данные недоступны, расчёт можно продолжить вручную.</p>
 </details>;
}
