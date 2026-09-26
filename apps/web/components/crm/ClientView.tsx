'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {List,LayoutGrid} from 'lucide-react';
export function ClientView({children}:{children:ReactNode}){
 const [view,setView]=useState('list');useEffect(()=>{try{setView(localStorage.getItem('avtocena_clients_view')==='grid'?'grid':'list')}catch{}},[]);
 function choose(value:string){setView(value);try{localStorage.setItem('avtocena_clients_view',value)}catch{}}
 return <><div className="mb-3 flex justify-end gap-2" aria-label="Вид клиентов"><button type="button" aria-label="Список клиентов" aria-pressed={view==='list'} onClick={()=>choose('list')} className="crm-view-toggle"><List size={19}/></button><button type="button" aria-label="Плитки клиентов" aria-pressed={view==='grid'} onClick={()=>choose('grid')} className="crm-view-toggle"><LayoutGrid size={19}/></button></div><div className={`crm-clients-list ${view==='grid'?'crm-clients-grid':''}`}>{children}</div></>;
}
