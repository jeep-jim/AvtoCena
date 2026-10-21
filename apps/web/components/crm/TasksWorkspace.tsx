'use client';
import {useEffect,useState} from 'react';
import type {CrmReminder} from '@/lib/crm-reminders';
import {ReminderRows,remindersChanged} from './Reminders';
const day=(d:string|number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Novokuznetsk',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d));
export function TasksWorkspace({initialRows,userId,people}:{initialRows:CrmReminder[];userId:string;people:{id:string;name:string}[]}){
 const [rows,setRows]=useState(initialRows),[period,setPeriod]=useState('today'),[person,setPerson]=useState(userId),[ownerId,setOwner]=useState(userId),[text,setText]=useState(''),[due,setDue]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function refresh(){try{const r=await fetch('/api/crm/reminders',{cache:'no-store'});if(!r.ok)throw Error();setRows((await r.json()).reminders||[]);}catch{setError('Не удалось обновить задачи.');}}
 useEffect(()=>{const update=()=>void refresh();window.addEventListener('avtocena:reminders',update);return()=>window.removeEventListener('avtocena:reminders',update);},[]);
 const today=day(Date.now());const selected=rows.filter(r=>!r.doneAt&&(!person||r.ownerId===person)).filter(r=>period==='all'||(period==='today'?day(r.dueAt)===today:period==='overdue'?Date.parse(r.dueAt)<Date.now():day(r.dueAt)>today));
 return <div className="space-y-5"><form className="grid gap-3 rounded-2xl border border-[var(--ac-border)] p-4 md:grid-cols-2" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const r=await fetch('/api/crm/reminders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({entityType:'task',ownerId,text,dueAt:new Date(`${due}:00+07:00`).toISOString()})});const data=await r.json();if(!r.ok)throw Error(data.error);setText('');setDue('');remindersChanged();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
 <label className="md:col-span-2">Что сделать<textarea required maxLength={1000} rows={2} className="soft-input mt-1 w-full rounded-xl p-3" value={text} onChange={e=>setText(e.target.value)}/></label>
 <label>Ответственный<select className="soft-input mt-1 w-full rounded-xl p-3" value={ownerId} onChange={e=>setOwner(e.target.value)}>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 <label>Срок · Новокузнецк<input type="datetime-local" required className="soft-input mt-1 w-full rounded-xl p-3" value={due} onChange={e=>setDue(e.target.value)}/></label>
 <button disabled={busy} className="avto-button rounded-xl p-3">{busy?'Сохраняем…':'Добавить задачу'}</button></form>
 <div className="flex flex-wrap gap-2">{[['today','Сегодня'],['overdue','Просрочены'],['future','Предстоящие'],['all','Все активные']].map(([value,label])=><button key={value} onClick={()=>setPeriod(value)} aria-pressed={period===value} className={`rounded-xl px-4 py-2 ${period===value?'bg-red-500 text-white':'border border-[var(--ac-border)]'}`}>{label}</button>)}<select aria-label="Задачи сотрудника" className="soft-input rounded-xl p-2" value={person} onChange={e=>setPerson(e.target.value)}><option value="">Все доступные</option>{people.map(p=><option key={p.id} value={p.id}>{p.id===userId?'Мои задачи':p.name}</option>)}</select></div>
 {error&&<p role="alert">{error}</p>}<p className="text-sm text-[var(--ac-muted)]">Задач: {selected.length}. Здесь также собраны напоминания из заявок и карточек клиентов.</p>
 <ReminderRows rows={selected} onChange={()=>void refresh()}/>{!selected.length&&<p className="rounded-2xl bg-[var(--ac-surface-2)] p-5">На этот период задач нет.</p>}</div>;
}
