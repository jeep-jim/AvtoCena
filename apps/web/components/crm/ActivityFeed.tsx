'use client';
import {useEffect,useState} from 'react';
import {ArrowRight,ChevronDown,RefreshCw} from 'lucide-react';
import type {CrmActivity,ActivityPerson} from '../../lib/crm-activity';
import {defaultManagerAvatar} from '../../lib/default-avatars';
import {crmDateTime} from '../../lib/crm-time';
function Person({person}:{person?:ActivityPerson}){return <span className="crm-event-person"><img src={person?.avatarUrl||defaultManagerAvatar(person?.id||'site')} alt="" width={32} height={32}/><span>{person?.name||'Сайт'}</span></span>;}
export function ActivityFeed({compact=false}:{compact?:boolean}){
 const [events,setEvents]=useState<CrmActivity[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[mine,setMine]=useState(false),[userId,setUserId]=useState(''),[loadingMore,setLoadingMore]=useState(false),[more,setMore]=useState(true);
 const limit=compact?12:40;
 useEffect(()=>{let active=true,busy=false;const controller=new AbortController();const refresh=async()=>{
  if(busy||document.visibilityState!=='visible')return;busy=true;
  try{const r=await fetch(`/api/crm/activity?limit=${limit}`,{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error();const d=await r.json();if(active){setEvents(old=>{const latest=(Array.isArray(d.events)?d.events:[]) as CrmActivity[];return [...latest,...old.filter(e=>!latest.some(n=>n.id===e.id))].slice(0,compact?limit:500)});setLoaded(true);setError('');setUserId(d.userId||'');}}
  catch{if(active)setError('Не удалось обновить ленту. Повторим автоматически.');}finally{busy=false;}
 };void refresh();const timer=setInterval(refresh,20_000);document.addEventListener('visibilitychange',refresh);window.addEventListener('avtocena:crm-change',refresh);return()=>{active=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('avtocena:crm-change',refresh);};},[limit,compact]);
 async function older(){setLoadingMore(true);try{const r=await fetch(`/api/crm/activity?limit=${limit}&before=${encodeURIComponent(events.at(-1)?.createdAt||'')}`,{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();setEvents(old=>[...old,...d.events.filter((e:CrmActivity)=>!old.some(x=>x.id===e.id))]);setMore(d.events.length===limit);}catch{setError('Не удалось загрузить историю. Попробуйте ещё раз.');}finally{setLoadingMore(false);}}
 return <section className="crm-activity" aria-label="Лента действий команды">
 {!compact?<div className="mb-4 flex flex-wrap items-center gap-2"><button type="button" aria-pressed={!mine} className="soft-input rounded-xl px-4 py-2" onClick={()=>setMine(false)}>Общая лента</button><button type="button" aria-pressed={mine} className="soft-input rounded-xl px-4 py-2" onClick={()=>setMine(true)}>Мои действия</button><span className="text-xs text-[var(--ac-muted)]">Обновляется автоматически · время Новокузнецка</span></div>:null}
 {error?<p role="status" className="mb-3 text-sm text-[var(--ac-muted)]">{error}</p>:null}
 {!loaded&&!error?<p className="text-sm text-[var(--ac-muted)]">Загружаем события…</p>:null}
 {events.filter(e=>!mine||e.actor?.id===userId).map(e=><details key={e.id} className="crm-event">
  <summary>{e.image?<img className="crm-event-car" src={e.image} alt="Автомобиль из заявки" loading="lazy"/>:null}<div className="crm-event-people"><Person person={e.actor}/>{e.target?<><ArrowRight size={16}/><Person person={e.target}/></>:null}</div><span className="crm-event-meta"><time dateTime={e.createdAt}>{crmDateTime(e.createdAt)}</time>{e.currentStatus?<span className="crm-event-status">{e.currentStatus}</span>:null}</span><strong>{e.title}</strong>{e.entityLabel?<span className="crm-event-label">{e.entityLabel}</span>:null}<ChevronDown size={16} className="crm-event-chevron"/></summary>
  <div className="crm-event-detail">{e.text?<p className="whitespace-pre-wrap">{e.text}</p>:null}{e.changes?.map((change,i)=><div className="crm-event-change" key={i}><b>{change.label}</b><span>{change.before||'Не указано'} <ArrowRight size={13}/> {change.after||'Не указано'}</span></div>)}{e.href?<a href={e.href} className="mt-3 inline-flex min-h-11 items-center gap-2 font-bold text-red-400">Открыть {e.entityType==='offer'?'автомобиль':e.entityType==='contract'?'договор':'подробности'} <ArrowRight size={16}/></a>:null}{!e.text&&!e.changes?.length&&!e.href?<p>Действие зафиксировано {crmDateTime(e.createdAt)}.</p>:null}</div>
 </details>)}
 {loaded&&!events.length?<p className="py-5 text-sm text-[var(--ac-muted)]">Событий пока нет. Новые действия будут появляться здесь автоматически.</p>:null}
 {!compact&&more&&events.length>=limit?<button type="button" disabled={loadingMore} onClick={older} className="soft-input mt-4 flex min-h-11 items-center gap-2 rounded-xl px-4"><RefreshCw size={16}/> {loadingMore?'Загружаем…':'Показать ещё'}</button>:null}
 </section>;
}
