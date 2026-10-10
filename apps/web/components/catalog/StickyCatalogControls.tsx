"use client";
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import './sticky-catalog-controls.css';
type Chip={key:string;label:string};
const sorts=[['','По умолчанию'],['totalRub','Сначала дешевле'],['totalRubDesc','Сначала дороже'],['year','Сначала новые'],['yearAsc','Сначала старше']] as const;
export function StickyCatalogControls({chips,onRemove,sort,onSort,hidden=false}:{chips:Chip[];onRemove:(key:string)=>void;sort:string;onSort:(value:string)=>void;hidden?:boolean}){
 const sentinel=useRef<HTMLDivElement>(null),menu=useRef<HTMLDivElement>(null);
 const [visible,setVisible]=useState(false),[top,setTop]=useState(64),[open,setOpen]=useState(false);
 useEffect(()=>{
  const header=document.querySelector<HTMLElement>('.ac-public-header');
  const measure=()=>setTop(Math.round(header?.getBoundingClientRect().height||64));measure();
  const observer=new ResizeObserver(measure);if(header)observer.observe(header);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{const marker=sentinel.current;if(!marker)return;const observer=new IntersectionObserver(([entry])=>setVisible(entry.boundingClientRect.top<top),{rootMargin:`-${top}px 0px 0px 0px`,threshold:0});observer.observe(marker);return()=>observer.disconnect();},[top]);
 useEffect(()=>{if(!visible||hidden)setOpen(false);},[visible,hidden]);
 useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node))setOpen(false);};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};document.addEventListener('pointerdown',outside);window.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',escape);};},[open]);
 return <><div ref={sentinel} className="ac-catalog-sticky-sentinel" aria-hidden="true"/>{visible&&!hidden&&createPortal(<nav className="ac-catalog-sticky" style={{top}} aria-label="Выбранные фильтры и сортировка">
  <div className="ac-catalog-sticky-inner">
   <div className="ac-catalog-sticky-chips" tabIndex={0} aria-label="Выбранные параметры">{chips.length?chips.map(chip=><button key={chip.key} type="button" className="ac-catalog-sticky-chip" aria-label={`Убрать ${chip.label}`} onClick={()=>onRemove(chip.key)}><span>{chip.label}</span><span aria-hidden="true">×</span></button>):<span className="ac-catalog-sticky-empty">Все автомобили</span>}</div>
   <div ref={menu} className="ac-catalog-sticky-sort"><button type="button" className={`ac-catalog-sticky-icon ${sort?'is-active':''}`} aria-label="Сортировка автомобилей" title="Сортировка" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h11M4 18h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></button>
    {open&&<div className="ac-catalog-sticky-menu" role="group" aria-label="Порядок автомобилей">{sorts.map(([value,label])=><button key={value} type="button" aria-pressed={sort===value} onClick={()=>{onSort(value);setOpen(false);}}><span>{label}</span>{sort===value&&<span aria-hidden="true">✓</span>}</button>)}</div>}
   </div>
   <button type="button" className="ac-catalog-sticky-icon" aria-label="Наверх к фильтрам" title="Наверх" onClick={()=>window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 7-7 7 7M12 5v15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
  </div>
 </nav>,document.body)}</>;
}
