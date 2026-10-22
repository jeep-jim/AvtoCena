"use client";
import {useEffect,useRef,useState} from 'react';
import {catalogSortOptions,parseCatalogSort,toggleCatalogSort} from '@/lib/catalog/catalog-sort';
export function CatalogSortSelect({value,onChange,hidePrice=false,showAuctionDate=false}:{value:string;onChange:(value:string)=>void;hidePrice?:boolean;showAuctionDate?:boolean}){
 const [open,setOpen]=useState(false);const root=useRef<HTMLDivElement>(null);const selected=parseCatalogSort(value)||[];
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopImmediatePropagation();setOpen(false);root.current?.querySelector<HTMLButtonElement>(':scope > button')?.focus();}};document.addEventListener('pointerdown',outside);window.addEventListener('keydown',escape,true);return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',escape,true);};},[open]);
 const title=selected.map(term=>catalogSortOptions.find(o=>o.value===term)!.label).join(' → ')||'Без сортировки';
 return <div ref={root} className={`ac-sort-select relative min-w-0 ${open?'z-[240]':'z-0'}`}>
  <input type="hidden" name="sort" value={selected.join(',')}/>
  <button type="button" aria-label={`Сортировка: ${title}`} aria-expanded={open} onClick={()=>setOpen(!open)} className="ac-filter-control flex h-13 w-full items-center justify-between gap-2 rounded-[15px] px-4 text-left text-sm font-black"><span className="ac-sort-title truncate" title={title}>{title}</span><svg className="ac-sort-mobile-icon hidden" width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 19V5m-4 4 4-4 4 4M16 5v14m-4-4 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg><svg width="17" height="17" viewBox="0 0 18 18" fill="none" className={`ac-sort-chevron shrink-0 ${open?'rotate-180':''}`} aria-hidden="true"><path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
  {open&&<div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2">
   <p className="px-3 py-2 text-xs text-[var(--ac-muted)]">Выбирайте по важности. Следующее условие — при равенстве предыдущего.</p>
   <div className="ac-hide-scrollbar max-h-64 overflow-y-auto" role="group" aria-label="Порядок сортировки">
    <button type="button" aria-pressed={!selected.length} onClick={()=>onChange('')} className={`ac-filter-option flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${!selected.length?'is-active':''}`}>Без сортировки{!selected.length&&<span aria-hidden="true">✓</span>}</button>
    {catalogSortOptions.filter(o=>showAuctionDate||o.field!=="auctionDate").filter(o=>!hidePrice||o.field!=='price').map(option=><button key={option.value} type="button" aria-pressed={selected.includes(option.value)} onClick={()=>onChange(toggleCatalogSort(value,option.value))} className={`ac-filter-option flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${selected.includes(option.value)?'is-active':''}`}><span>{option.label}</span>{selected.includes(option.value)&&<span aria-label={`Приоритет ${selected.indexOf(option.value)+1}`}>{selected.indexOf(option.value)+1}</span>}</button>)}
   </div>
   <button type="button" onClick={()=>setOpen(false)} className="ac-filter-option min-h-10 w-full rounded-xl px-3 py-2 text-left text-sm font-bold">Готово</button>
  </div>}
 </div>;
}
