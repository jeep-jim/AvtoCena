'use client';
import {useRef,type ReactNode} from 'react';
import {SlidersHorizontal,X,ChevronUp} from 'lucide-react';
export function LeadFilters({children,count=0}:{children:ReactNode;count?:number}){
 const dialog=useRef<HTMLDialogElement>(null);
 return <div className="crm-lead-filter-control"><button type="button" className="crm-filter-trigger" aria-label={count ? `Фильтры: ${count}` : "Фильтры"} onClick={()=>dialog.current?.showModal()}><SlidersHorizontal size={17}/><span className="crm-filter-label">Фильтры</span>{count>0&&<b>{count}</b>}</button><dialog ref={dialog} aria-label="Фильтры заявок" className="crm-lead-filter-dialog" onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.current?.close();}}}><header><h2>Фильтры заявок</h2><button type="button" aria-label="Закрыть фильтры" onClick={()=>dialog.current?.close()}><X size={22}/></button></header>{children}</dialog></div>;
}
export function CollapseLead(){return <button type="button" className="crm-collapse-lead" onClick={e=>{const details=e.currentTarget.closest('details');if(details){details.open=false;details.querySelector('summary')?.focus();details.scrollIntoView({block:'nearest',behavior:'smooth'});}}}><ChevronUp size={16}/>Свернуть заявку</button>;}
