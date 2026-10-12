import Link from 'next/link';
import {LEAD_COLUMNS,leadColumn} from '@/lib/crm-lead-board';
import {leadStatusLabel} from '@/lib/crm';
import {crmDateTime} from '@/lib/crm-time';
export function LeadBoard({groups,managers}:{groups:any[][];managers:{id:string;displayName:string}[]}){
 return <div className="flex gap-4 overflow-x-auto pb-5" aria-label="Заявки по этапам">{LEAD_COLUMNS.map(column=>{
 const selected=groups.filter(group=>leadColumn(group[0].status)===column.id);
 return <section key={column.id} className="w-[320px] max-w-[85vw] shrink-0 rounded-2xl bg-[var(--ac-surface-2)] p-3" aria-label={column.title}>
 <h2 className="mb-3 flex justify-between border-b-2 border-red-500 pb-3 font-bold">{column.title}<span>{selected.length}</span></h2>
 <div className="space-y-3">{selected.map(group=><article key={group[0].id} className="rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-3">
 <strong className="block break-words">{group[0].name||'Клиент'}</strong><p className="text-sm text-[var(--ac-muted)]">{group[0].phone||group[0].telegram||'Контакт в заявке'}</p>
 {group.map(lead=><Link key={lead.id} href={`/crm/leads?id=${encodeURIComponent(lead.id)}&layout=list`} className="mt-3 block rounded-lg border border-[var(--ac-border)] p-2 hover:border-red-500">
 <span className="block font-semibold">{lead.selectedOffers?.map((o:any)=>o.title).filter(Boolean).join(' · ')||lead.offerTitle||lead.car||'Подбор автомобиля'}</span>
 <span className="my-1 block text-sm text-red-500">{leadStatusLabel(lead.status)}</span>
 <span className="block text-xs">{managers.find(m=>m.id===lead.assignedManagerId)?.displayName||'Без ответственного'}</span>
 <time className="block text-xs text-[var(--ac-muted)]">{crmDateTime(lead.createdAt)}</time>
 {lead.createdOffice&&<span className="block text-xs">Первое обращение: {lead.createdOffice}</span>}
 </Link>)}
 </article>)}{!selected.length&&<p className="py-4 text-sm text-[var(--ac-muted)]">Пока нет заявок</p>}</div></section>;
 })}</div>;
}
