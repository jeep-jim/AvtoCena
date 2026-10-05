'use client';
import {useEffect,useState} from 'react';
import {ArrowRight,ChevronDown,RefreshCw} from 'lucide-react';
import type {CrmActivity,ActivityPerson} from '../../lib/crm-activity';
import {defaultManagerAvatar} from '../../lib/default-avatars';
import {groupCrmActivity} from '../../lib/crm-activity-groups';
import {leadMetrikaStage} from '../../lib/crm';
import {crmDateTime} from '../../lib/crm-time';
function Person({person}:{person?:ActivityPerson}){return <span className="crm-event-person"><img src={person?.avatarUrl||defaultManagerAvatar(person?.id||'site')} alt="" width={32} height={32}/><span>{person?.name||'Сайт'}</span></span>;}
export function ActivityFeed({compact=false}:{compact?:boolean}){
 const [events,setEvents]=useState<CrmActivity[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[mine,setMine]=useState(false),[userId,setUserId]=useState(''),[loadingMore,setLoadingMore]=useState(false),[more,setMore]=useState(true);
 const limit=compact?12:40;
 useEffect(()=>{let active=true,busy=false;const controller=new AbortController();const refresh=async()=>{
  if(busy||document.visibilityState!=='visible')return;busy=true;
  try{const r=await fetch(`/api/crm/activity?limit=${limit}`,{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error();const d=await r.json();if(active){setEvents(old=>{const latest=(Array.isArray(d.events)?d.events:[]) as CrmActivity[];return [...latest,...old.filter(e=>latest.length>0&&e.createdAt<latest[latest.length-1].createdAt&&!latest.some(n=>n.id===e.id))].slice(0,compact?limit:500)});setLoaded(true);setError('');setUserId(d.userId||'');}}
  catch{if(active)setError('Не удалось обновить ленту. Повторим автоматически.');}finally{busy=false;}
 };void refresh();const timer=setInterval(refresh,20_000);document.addEventListener('visibilitychange',refresh);window.addEventListener('avtocena:crm-change',refresh);return()=>{active=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('avtocena:crm-change',refresh);};},[limit,compact]);
 async function older(){setLoadingMore(true);try{const r=await fetch(`/api/crm/activity?limit=${limit}&before=${encodeURIComponent(events.at(-1)?.createdAt||'')}`,{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();setEvents(old=>[...old,...d.events.filter((e:CrmActivity)=>!old.some(x=>x.id===e.id))]);setMore(d.events.length===limit);}catch{setError('Не удалось загрузить историю. Попробуйте ещё раз.');}finally{setLoadingMore(false);}}
 return <section className="crm-activity" aria-label="Лента действий команды">
 {!compact?<div className="mb-4 flex flex-wrap items-center gap-2"><button type="button" aria-pressed={!mine} className="soft-input rounded-xl px-4 py-2" onClick={()=>setMine(false)}>Общая лента</button><button type="button" aria-pressed={mine} className="soft-input rounded-xl px-4 py-2" onClick={()=>setMine(true)}>Мои действия</button><span className="text-xs text-[var(--ac-muted)]">Обновляется автоматически · время Новокузнецка</span></div>:null}
 {error?<p role="status" className="mb-3 text-sm text-[var(--ac-muted)]">{error}</p>:null}
 {!loaded&&!error?<p className="text-sm text-[var(--ac-muted)]">Загружаем события…</p>:null}
 {groupCrmActivity(events.filter(e=>!mine||e.actor?.id===userId)).map(group=>group.events.length===1
  ? <ActivityEvent key={group.id} e={group.events[0]}/>
  : <details key={group.id} className="crm-event crm-event-group">
    <summary><div className="crm-event-people"><Person person={group.events[0].actor}/></div><span className="crm-event-meta"><time dateTime={group.events[0].createdAt}>{crmDateTime(group.events[0].createdAt)}</time></span><strong>{group.section}</strong><span className="crm-event-count" aria-label={`Действий внутри: ${group.events.length}`}>{group.events.length}</span><ChevronDown size={16} className="crm-event-chevron"/></summary>
    <div className="crm-event-children">{group.events.map(e=><ActivityEvent key={e.id} e={e}/>)}</div>
   </details>)}
 {loaded&&!events.length?<p className="py-5 text-sm text-[var(--ac-muted)]">Событий пока нет. Новые действия будут появляться здесь автоматически.</p>:null}
 {!compact&&more&&events.length>=limit?<button type="button" disabled={loadingMore} onClick={older} className="soft-input mt-4 flex min-h-11 items-center gap-2 rounded-xl px-4"><RefreshCw size={16}/> {loadingMore?'Загружаем…':'Показать ещё'}</button>:null}
 </section>;
}

function ActivityEvent({e}:{e:CrmActivity}){return <details className="crm-event">
  <summary>{e.image?<img className="crm-event-car" src={e.image} alt="Автомобиль из заявки" loading="lazy"/>:null}<div className="crm-event-people"><Person person={e.actor}/>{e.target?<><ArrowRight size={16}/><Person person={e.target}/></>:null}</div><span className="crm-event-meta"><time dateTime={e.createdAt}>{crmDateTime(e.createdAt)}</time>{e.currentStatus?<span className="crm-event-status" title={e.currentStatus} aria-label={e.currentStatus} data-metrika-stage={leadMetrikaStage(e.currentStatusCode)?.tone}>{leadMetrikaStage(e.currentStatusCode)?.marker} {e.currentStatusCode==='qualified'?'КВАЛ':e.currentStatus}</span>:null}</span><strong>{e.title}</strong>{e.entityLabel?<span className="crm-event-label">{e.entityLabel}</span>:null}<ChevronDown size={16} className="crm-event-chevron"/></summary>
  <div className="crm-event-detail">{e.text?<p className="whitespace-pre-wrap">{e.text}</p>:null}{e.changes?.map((change,i)=><div className="crm-event-change" key={i}><b>{change.label}</b><span>{change.before||'Не указано'} <ArrowRight size={13}/> {change.after||'Не указано'}</span></div>)}{e.href?<a href={e.href} className="mt-3 inline-flex min-h-11 items-center gap-2 font-bold text-red-400">Открыть {['lead_note_added','client_note_added','lead_note_edited','client_note_edited'].includes(e.type)||(e.type==='client_updated'&&e.changes?.some(c=>c.label==='Комментарий'))?'обсуждение и ответить':e.type.startsWith('reminder_')?'напоминание':e.entityType==='review'?'отзыв и ответить':e.entityType==='offer'?'автомобиль':e.entityType==='contract'?'договор':e.entityType==='lead'?'заявку':e.entityType==='client'?'клиента':'подробности'} <ArrowRight size={16}/></a>:null}{!e.text&&!e.changes?.length&&!e.href?<p>Действие зафиксировано {crmDateTime(e.createdAt)}.</p>:null}</div>
 </details>;}
