'use client';
import {useEffect,useRef,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {CatalogMarketFlag} from '@/components/catalog/CatalogMarketFlag';
import {markets} from '@/lib/contracts/model';
export function ContractMarketSelect({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[open]);
 return <div ref={root} className="contract-market-select" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}}}>
 <button ref={trigger} type="button" aria-label={`${label}: ${markets[value]}`} aria-expanded={open} onClick={()=>setOpen(!open)}><CatalogMarketFlag market={value}/><span>{markets[value]}</span><ChevronDown size={16}/></button>
 {open&&<div className="contract-market-menu" role="group" aria-label={label}>{Object.entries(markets).map(([id,name])=><button key={id} type="button" aria-label={name} aria-pressed={id===value} onClick={()=>{onChange(id);setOpen(false);trigger.current?.focus();}}><CatalogMarketFlag market={id}/>{name}</button>)}</div>}
 </div>;
}
