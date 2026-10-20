"use client";
import {CatalogSortSelect} from "./CatalogSortSelect";
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import './sticky-catalog-controls.css';
import {SelectedFilterChip, type SelectedFilter} from "./SelectedFilterChip";
type Chip=SelectedFilter;

export function StickyCatalogControls({chips,onRemove,sort,onSort,hidden=false,hidePrice=false}:{chips:Chip[];onRemove:(key:string)=>void;sort:string;onSort:(value:string)=>void;hidden?:boolean;hidePrice?:boolean}){
 const sentinel=useRef<HTMLDivElement>(null);
 const [visible,setVisible]=useState(false),[top,setTop]=useState(64),[leftPadding,setLeftPadding]=useState(28);
 useEffect(()=>{
  const header=document.querySelector<HTMLElement>('.ac-public-header');
  const measure=()=>{
   setTop(Math.round(header?.getBoundingClientRect().height||64));
   const width=document.documentElement.clientWidth;
   const contentLeft=sentinel.current?.getBoundingClientRect().left||0;
   setLeftPadding(Math.max(width<1024?12:28,contentLeft-Math.max(0,(width-1600)/2)));
  };measure();
  const observer=new ResizeObserver(measure);if(header)observer.observe(header);if(sentinel.current)observer.observe(sentinel.current);window.addEventListener("resize",measure);return()=>{observer.disconnect();window.removeEventListener("resize",measure);};
 },[]);
 useEffect(()=>{const marker=sentinel.current;if(!marker)return;const observer=new IntersectionObserver(([entry])=>setVisible(entry.boundingClientRect.top<top),{rootMargin:`-${top}px 0px 0px 0px`,threshold:0});observer.observe(marker);return()=>observer.disconnect();},[top]);
 return <><div ref={sentinel} className="ac-catalog-sticky-sentinel" aria-hidden="true"/>{visible&&!hidden&&createPortal(<nav className="ac-catalog-sticky backdrop-blur-xl" style={{top}} aria-label="Выбранные фильтры и сортировка">
  <div className="ac-catalog-sticky-inner" style={{paddingLeft:leftPadding}}>
   <div className="ac-catalog-sticky-chips" tabIndex={0} aria-label="Выбранные параметры">{chips.length?chips.map(chip=><SelectedFilterChip key={chip.key} chip={chip} onRemove={onRemove} />):<span className="ac-catalog-sticky-empty">Все автомобили</span>}</div>
   <div className="min-w-0 w-56"><CatalogSortSelect value={sort} onChange={onSort} hidePrice={hidePrice}/></div>
   <button type="button" className="ac-catalog-sticky-icon" aria-label="Наверх к фильтрам" title="Наверх" onClick={()=>window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 7-7 7 7M12 5v15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
  </div>
 </nav>,document.body)}</>;
}
