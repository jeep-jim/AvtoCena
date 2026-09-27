"use client";
import {useEffect,useId,useState} from 'react';
import {ChevronDown,Phone} from 'lucide-react';
import {defaultManagerAvatar} from '../../lib/default-avatars';
import {normalizeStaffPhone} from '../../lib/staff-phone';
export function StaffHeartbeat(){
 useEffect(()=>{let busy=false;const ping=async()=>{if(busy||document.visibilityState!=='visible')return;busy=true;try{await fetch('/api/crm/presence',{method:'POST'});}catch{}finally{busy=false;}};void ping();const timer=setInterval(()=>void ping(),60_000);document.addEventListener('visibilitychange',ping);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',ping);};},[]);return null;
}
type Person={id:string;displayName:string;avatarUrl?:string;personalPhone?:string;lastSeenAt?:string;lastLoginAt?:string;online:boolean};
function presenceLabel(person:Person){
 if(person.online)return 'В сети';
 const date=person.lastSeenAt||person.lastLoginAt;
 return date?`Был(а) ${new Date(date).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Novokuznetsk'})}`:'Ещё не заходил(а)';
}
export function StaffPresence(){
 const [team,setTeam]=useState<Person[]>([]),[loaded,setLoaded]=useState(false),[expanded,setExpanded]=useState(false);
 const listId=useId();
 useEffect(()=>{let active=true;const refresh=async()=>{if(document.visibilityState!=='visible')return;try{const r=await fetch('/api/crm/presence',{cache:'no-store'});if(!r.ok)return;const d=await r.json();if(active){setTeam(d.team||[]);setLoaded(true);}}catch{}};void refresh();const timer=setInterval(()=>void refresh(),60_000);document.addEventListener('visibilitychange',refresh);return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};},[]);
 return <section className="crm-presence glass mt-5 rounded-3xl p-5" aria-label="Активность сотрудников">
  <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black">Команда в сети</h2><button type="button" className="crm-presence-toggle" aria-label={expanded?'Свернуть команду':'Развернуть команду'} aria-expanded={expanded} aria-controls={listId} onClick={()=>setExpanded(value=>!value)}><ChevronDown size={24} aria-hidden="true" style={{transform:expanded?'rotate(180deg)':undefined}}/></button></div>
  <div id={listId}>
   {expanded?<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{team.map(person=>{
    const phone=normalizeStaffPhone(person.personalPhone||'');
    return <div key={person.id} className="crm-presence-card flex min-w-0 items-center gap-2 rounded-2xl p-3">
     <a href={`/crm/managers/${encodeURIComponent(person.id)}`} className="flex min-w-0 flex-1 items-center gap-3"><img src={person.avatarUrl||defaultManagerAvatar(person.id)} width={44} height={44} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover"/><div className="min-w-0"><p className="truncate font-bold" title={person.displayName}>{person.displayName}</p><p className="flex items-center gap-2 text-xs text-[var(--ac-muted)]" title={person.online?'Активность в последние 2 минуты':undefined}><span className={`h-2 w-2 shrink-0 rounded-full ${person.online?'bg-emerald-500':'bg-slate-500'}`}/><span>{presenceLabel(person)}</span></p></div></a>
     {phone?<a className="crm-presence-call" href={`tel:${phone}`} aria-label={`Позвонить: ${person.displayName}`} title={`Позвонить: ${phone}`}><Phone size={20} aria-hidden="true"/></a>:<button type="button" disabled className="crm-presence-call" aria-label={`Личный телефон не указан: ${person.displayName}`} title="Личный телефон не указан"><Phone size={20} aria-hidden="true"/></button>}
    </div>;
   })}</div>:<div className="crm-presence-rail">{team.map(person=><a key={person.id} className="crm-presence-person" href={`/crm/managers/${encodeURIComponent(person.id)}`} title={`${person.displayName} · ${presenceLabel(person)}`} aria-label={`${person.displayName} · ${presenceLabel(person)}`}><span className="crm-presence-avatar"><img src={person.avatarUrl||defaultManagerAvatar(person.id)} width={56} height={56} alt=""/>{person.online?<span className="crm-presence-online" aria-label="В сети"/>:null}</span><span className="crm-presence-name">{person.displayName}</span></a>)}</div>}
  </div>
  {!loaded?<p className="mt-3 text-sm text-[var(--ac-muted)]">Загружаем активность…</p>:team.length===0?<p className="mt-3 text-sm text-[var(--ac-muted)]">Сотрудников пока нет</p>:null}
 </section>;
}
