'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {List,LayoutGrid} from 'lucide-react';
export function ClientView({children}:{children:ReactNode}){
 const [target,setTarget]=useState<HTMLElement|null>(null);useEffect(()=>{const media=window.matchMedia('(max-width:767px)');const place=()=>setTarget(document.getElementById(media.matches?'crm-client-view-mobile':'crm-client-view-controls')||document.getElementById('crm-client-view-controls'));place();media.addEventListener('change',place);return()=>media.removeEventListener('change',place);},[]);
 const [view,setView]=useState('list');useEffect(()=>{try{setView(localStorage.getItem('avtocena_clients_view')==='grid'?'grid':'list')}catch{}},[]);
 function choose(value:string){setView(value);try{localStorage.setItem('avtocena_clients_view',value)}catch{}}
 const controls=<div className="crm-client-view-controls" aria-label="Вид клиентов"><button type="button" aria-label="Список клиентов" aria-pressed={view==='list'} onClick={()=>choose('list')} className="crm-view-toggle"><List size={19}/></button><button type="button" aria-label="Плитки клиентов" aria-pressed={view==='grid'} onClick={()=>choose('grid')} className="crm-view-toggle"><LayoutGrid size={19}/></button></div>;return <>{target?createPortal(controls,target):null}<div className={`crm-clients-list ${view==='grid'?'crm-clients-grid':''}`}>{children}</div></>;
}
