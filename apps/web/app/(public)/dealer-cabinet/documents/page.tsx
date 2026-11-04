import {readyDealerClients} from '@/lib/dealers/client-workflow';
import {customerLeads} from '@/lib/account/portal';
import {CustomerAccess} from "@/components/account/CustomerAccess";
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {canUseDocuments,documentCompany,workspaceClientsPath,canAccessDocumentClient} from '@/lib/document-workspace';
import {readChunkedDataJson} from '@/lib/data';
import {ContractWorkspace} from '@/components/crm/contracts/ContractWorkspace';
import {ClientDocuments} from '@/components/crm/ClientDocuments';
import {DocumentTrash} from '@/components/crm/DocumentTrash';
import {DealerClientForm} from '@/components/dealers/DealerClientForm';
import type {ClientDocument} from '@/lib/client-documents';
import {CrmPageHeading} from '@/components/crm/CrmWorkspaceFrame';
import {CrmClientIdentity} from '@/components/crm/CrmRecordViews';
import {ClientView} from '@/components/crm/ClientView';
import {ClientCreatePanel} from '@/components/crm/ClientCreatePanel';
import {readCrmUsers} from '@/lib/crm-users';
import {clientManagerId,crmDateTime} from '@/lib/crm-time';
import {defaultManagerAvatar} from '@/lib/default-avatars';
import {clientStatusLabel} from '@/lib/crm-client-status';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams?:Promise<Record<string,string|string[]|undefined>>}){
 const user=await getCurrentUser();if(!user)redirect('/login?next=/dealer-cabinet/documents');
 if(!documentCompany(user))redirect('/crm/documents');if(!await canUseDocuments(user))redirect('/dealer-cabinet');
 const clients=await readyDealerClients(user,(await readChunkedDataJson<any>(workspaceClientsPath(user),[])).filter(c=>canAccessDocumentClient(user,c)));
 const params=await searchParams||{};const q=String(params.q||'').trim(),managerId=String(params.manager||'');
 const managers=(await readCrmUsers()).filter(m=>m.companyId===documentCompany(user)&&m.status!=='disabled'&&m.dealerApproved===true);
 const matching=clients.filter(c=>!managerId||clientManagerId(c)===managerId).filter(c=>!q||[c.fio,c.phone,c.telegram,c.city,c.comment].filter(Boolean).join(' ').toLocaleLowerCase('ru').includes(q.toLocaleLowerCase('ru'))).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
 const leadsByClient=new Map(await Promise.all(clients.map(async c=>[c.id,await customerLeads(documentCompany(user)!,c.id)] as const)));
 const trash=clients.flatMap(c=>(c.documents||[]).filter((d:ClientDocument)=>d.deletedAt).map((document:ClientDocument)=>({clientId:c.id,clientName:c.fio,document})));
 return <section className="dealer-cabinet-content">
  <CrmPageHeading title="Клиенты" help="Клиентская база, контакты и документы вашей компании. Клиент из заявки появляется здесь после назначения менеджера и выбора результата общения."/>
  <nav className="mb-5 flex gap-3 overflow-x-auto whitespace-nowrap" aria-label="Разделы клиентов"><a href="#clients" className="avto-button shrink-0 rounded-xl px-4 py-2">Клиентская база</a><a href="#contracts" className="shrink-0 rounded-xl border border-[var(--ac-border)] px-4 py-2">Документы</a><a href="#document-trash" className="shrink-0 rounded-xl border border-[var(--ac-border)] px-4 py-2">Архив документов</a></nav>
  <div className="crm-clients-layout" id="clients"><section className="min-w-0" aria-label="Клиентская база">
   <form className="crm-client-search" action="/dealer-cabinet/documents"><input name="q" defaultValue={q} aria-label="Поиск клиентов" placeholder="Имя, телефон, Telegram, город…" className="soft-input rounded-xl p-3"/><select name="manager" aria-label="Менеджер" defaultValue={managerId} className="soft-input rounded-xl p-3"><option value="">Все менеджеры</option>{managers.map(m=><option key={m.id} value={m.id}>{m.displayName}</option>)}</select><button className="avto-button rounded-xl px-4 font-bold">Найти</button></form>
   <div className="crm-client-results"><span>Найдено: {matching.length}</span>{(q||managerId)&&<Link href="/dealer-cabinet/documents">Сбросить поиск</Link>}<div id="crm-client-view-controls"/></div>
   <ClientView>{matching.map(c=>{const manager=managers.find(m=>m.id===clientManagerId(c));return <details key={c.id} id={c.id} className="crm-dealer-client"><summary className="crm-client-card cursor-pointer list-none [&::-webkit-details-marker]:hidden"><CrmClientIdentity name={c.fio||c.phone||'Клиент без имени'} contacts={[c.phone,c.telegram,c.city].filter(Boolean).join(' · ')} comment={c.comment}/><div className="crm-client-owner"><div className="crm-client-manager"><img src={manager?.avatarUrl||defaultManagerAvatar(clientManagerId(c))} alt="" width={36} height={36}/><span><strong>{manager?.displayName||'Не назначен'}</strong><time className="crm-client-date" dateTime={c.createdAt}>{crmDateTime(c.createdAt)}</time></span></div><div className="crm-client-statuses"><span>{clientStatusLabel(c.status)}</span></div></div></summary><div className="mt-3 rounded-2xl border border-[var(--ac-border)] p-4"><ClientDocuments apiBase="/api/dealers/clients" clientId={c.id} documents={(c.documents||[]).filter((d:ClientDocument)=>!d.deletedAt)} trashHref="#document-trash"/><CustomerAccess clientId={c.id} documents={c.documents||[]} leads={leadsByClient.get(c.id)||[]}/></div></details>})}{!matching.length&&<p className="rounded-2xl border border-[var(--ac-border)] p-6 text-[var(--ac-muted)]">{q||managerId?'Клиенты не найдены. Измените условия поиска.':'Клиентов пока нет. Добавьте первого клиента через форму.'}</p>}</ClientView>
  </section><aside id="new-client" className="crm-client-create" aria-label="Добавить клиента"><ClientCreatePanel><DealerClientForm/></ClientCreatePanel></aside></div>
  <section id="contracts" className="mt-8"><h2 className="mb-3 text-2xl font-bold">Документы компании</h2><p className="mb-4 text-sm text-[var(--ac-muted)]">Перед использованием проверьте текст шаблона, исполнителя, реквизиты и город. Изменения шаблонов вашей компании не затрагивают других дилеров.</p><ContractWorkspace endpoint="/api/dealers/contracts" owner clients={clients.map(c=>({id:c.id,name:c.fio,phone:c.phone||'',city:c.city||''}))}/></section><DocumentTrash apiBase="/api/dealers/clients" entries={trash} clientBase="/dealer-cabinet/documents#"/>
 </section>;
}
