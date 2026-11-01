"use client";
import {PUBLIC_HEADER_LAYOUT_EVENT} from '@/lib/public-header-layout';
import {SlidersHorizontal} from 'lucide-react';
import {CatalogSortSelect} from "./CatalogSortSelect";
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import './sticky-catalog-controls.css';
import {SelectedFilterChip, type SelectedFilter} from "./SelectedFilterChip";
type Chip=SelectedFilter;

export function StickyCatalogControls({chips,onRemove,sort,onSort,hidden=false,hidePrice=false,showAuctionDate=false,onOpenFilters}:{showAuctionDate?:boolean;onOpenFilters:()=>void;chips:Chip[];onRemove:(key:string)=>void;sort:string;onSort:(value:string)=>void;hidden?:boolean;hidePrice?:boolean}){
 const sentinel=useRef<HTMLDivElement>(null);
 const [visible,setVisible]=useState(false),[top,setTop]=useState(64),[leftPadding,setLeftPadding]=useState(28);
 useEffect(()=>{
  const header=document.querySelector<HTMLElement>('.ac-public-header');
  const measure=()=>{
   setTop(Math.round(header?.getBoundingClientRect().bottom||64));
   const width=document.documentElement.clientWidth;
   const contentLeft=sentinel.current?.getBoundingClientRect().left||0;
   setLeftPadding(Math.max(width<1024?12:28,contentLeft-Math.max(0,(width-1600)/2)));
  };measure();
  const observer=new ResizeObserver(measure);if(header)observer.observe(header);if(sentinel.current)observer.observe(sentinel.current);window.addEventListener("resize",measure);window.addEventListener(PUBLIC_HEADER_LAYOUT_EVENT,measure);return()=>{observer.disconnect();window.removeEventListener("resize",measure);window.removeEventListener(PUBLIC_HEADER_LAYOUT_EVENT,measure);};
 },[]);
 useEffect(()=>{const marker=sentinel.current;if(!marker)return;const observer=new IntersectionObserver(([entry])=>setVisible(entry.boundingClientRect.top<top),{rootMargin:`-${top}px 0px 0px 0px`,threshold:0});observer.observe(marker);return()=>observer.disconnect();},[top]);
 return <><div ref={sentinel} className="ac-catalog-sticky-sentinel" aria-hidden="true"/>{visible&&!hidden&&createPortal(<nav className="ac-catalog-sticky backdrop-blur-xl" style={{top}} aria-label="Выбранные фильтры и сортировка">
  <div className="ac-catalog-sticky-inner" style={{paddingLeft:leftPadding}}>
   <div className="ac-catalog-sticky-chips" tabIndex={0} aria-label="Выбранные параметры">{chips.length?chips.map(chip=><SelectedFilterChip key={chip.key} chip={chip} onRemove={onRemove} />):<span className="ac-catalog-sticky-empty">Все автомобили</span>}</div>
   <div className="ac-catalog-sticky-sort min-w-0 w-56"><CatalogSortSelect showAuctionDate={showAuctionDate} value={sort} onChange={onSort} hidePrice={hidePrice}/></div>
   <button type="button" className="ac-catalog-sticky-icon" aria-label="Открыть фильтры каталога" title="Фильтры" onClick={onOpenFilters}><SlidersHorizontal size={21} aria-hidden="true"/></button>
  </div>
 </nav>,document.body)}</>;
}
