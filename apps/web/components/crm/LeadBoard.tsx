import Link from 'next/link';
import {CarFront,UserRound} from 'lucide-react';
import {LEAD_COLUMNS,leadColumn} from '@/lib/crm-lead-board';
import {leadStatusLabel,leadMetrikaStage} from '@/lib/crm';
import {crmDateTime} from '@/lib/crm-time';
function image(lead:any){const value=lead.selectedOffers?.[0]?.image||lead.offerSnapshot?.image||lead.offerImageUrl;return typeof value==='string'&&(/^(https?:\/\/|\/[^/])/.test(value))?value:undefined;}
export function LeadBoard({groups,managers,avatars={}}:{groups:any[][];managers:{id:string;displayName:string}[];avatars?:Record<string,string>}){
 return <div className="crm-lead-board" aria-label="Заявки по этапам">{LEAD_COLUMNS.map(column=>{
 const selected=groups.filter(group=>leadColumn(group[0].status)===column.id);
 return <section key={column.id} className="crm-board-column" data-stage={column.id} aria-label={column.title}>
 <h2>{column.title}<span>{selected.length}</span></h2>
 <div className="space-y-3">{selected.map(group=><article key={group[0].id} className="crm-board-client">
 <header>{avatars[group[0].clientId]?<img src={avatars[group[0].clientId]} alt="" width={32} height={32}/>:<UserRound size={25}/>}<div><strong>{group[0].name||'Клиент'}</strong><p>{group[0].phone||group[0].telegram||'Контакт в заявке'}</p></div></header>
 {group.map(lead=><Link key={lead.id} href={`/crm/leads?id=${encodeURIComponent(lead.id)}&layout=list`} className="crm-board-car">
 <div className="crm-board-car-heading">{image(lead)?<img src={image(lead)} alt="" width={72} height={56} loading="lazy" referrerPolicy="no-referrer"/>:<span className="crm-board-car-placeholder"><CarFront size={26}/></span>}<strong>{lead.selectedOffers?.map((o:any)=>o.title).filter(Boolean).join(' · ')||lead.offerTitle||lead.car||'Подбор автомобиля'}</strong></div>
 <span className="crm-stage-badge" data-metrika-stage={leadMetrikaStage(lead.status)?.tone} data-stage={leadColumn(lead.status)}>{leadStatusLabel(lead.status)}</span>
 <footer><span>{managers.find(m=>m.id===lead.assignedManagerId)?.displayName||'Без ответственного'}</span><time>{crmDateTime(lead.createdAt)}</time></footer>
 </Link>)}
 </article>)}{!selected.length&&<p className="crm-board-empty">Пока нет заявок</p>}</div></section>;
 })}</div>;
}
