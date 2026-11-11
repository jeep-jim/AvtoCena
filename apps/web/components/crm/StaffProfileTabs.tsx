'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {UserRound,Files,CalendarDays} from 'lucide-react';
const tabs=[{id:'data',label:'Данные',hash:'staff-data',Icon:UserRound},{id:'documents',label:'Документы',hash:'staff-documents',Icon:Files},{id:'schedule',label:'График',hash:'team-schedule',Icon:CalendarDays}] as const;
type Tab=typeof tabs[number]['id'];
export function StaffProfileTabs({children,documents,schedule}:{children:ReactNode;documents?:ReactNode;schedule?:ReactNode}){
 const [active,setActive]=useState<Tab>('data'),[visited,setVisited]=useState<Tab[]>(['data']);
 function activate(id:Tab){setActive(id);setVisited(v=>v.includes(id)?v:[...v,id]);}
 useEffect(()=>{const sync=()=>{const found=tabs.find(t=>'#'+t.hash===location.hash);if(found&&(found.id==='data'||(found.id==='documents'?documents:schedule)))activate(found.id);};sync();window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync);},[]);
 const available=tabs.filter(t=>t.id==='data'||(t.id==='documents'?documents:schedule));
 return <section className="crm-staff-workspace glass"><div className="crm-staff-tabs" role="tablist" aria-label="Карточка сотрудника">{available.map((t,i)=><button key={t.id} type="button" role="tab" id={`staff-tab-${t.id}`} aria-controls={`staff-panel-${t.id}`} aria-selected={active===t.id} tabIndex={active===t.id?0:-1} onClick={()=>{activate(t.id);history.replaceState({},'',`${location.pathname}${location.search}#${t.hash}`);}} onKeyDown={e=>{const n=e.key==='ArrowRight'?(i+1)%available.length:e.key==='ArrowLeft'?(i+available.length-1)%available.length:e.key==='Home'?0:e.key==='End'?available.length-1:-1;if(n>=0){e.preventDefault();document.getElementById(`staff-tab-${available[n].id}`)?.focus();activate(available[n].id);}}}><t.Icon size={17}/>{t.label}</button>)}</div>
 {available.map(t=><div key={t.id} id={`staff-panel-${t.id}`} className="crm-staff-panel" role="tabpanel" aria-labelledby={`staff-tab-${t.id}`} hidden={active!==t.id} tabIndex={0}>{visited.includes(t.id)?t.id==='data'?children:t.id==='documents'?documents:schedule:null}</div>)}
 </section>;
}
