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
import '../../../(crm)/crm-responsive.css';
export const dynamic='force-dynamic';
export default async function Page(){
 const user=await getCurrentUser();if(!user)redirect('/login?next=/dealer-cabinet/documents');
 if(!documentCompany(user))redirect('/crm/documents');if(!await canUseDocuments(user))redirect('/dealer-cabinet');
 const clients=await readyDealerClients(user,(await readChunkedDataJson<any>(workspaceClientsPath(user),[])).filter(c=>canAccessDocumentClient(user,c)));
 const leadsByClient=new Map(await Promise.all(clients.map(async c=>[c.id,await customerLeads(documentCompany(user)!,c.id)] as const)));
 const trash=clients.flatMap(c=>(c.documents||[]).filter((d:ClientDocument)=>d.deletedAt).map((document:ClientDocument)=>({clientId:c.id,clientName:c.fio,document})));
 return <main className="crm-root min-h-screen"><div className="mx-auto max-w-7xl px-4 py-6"><nav className="mb-6 flex gap-5 overflow-x-auto whitespace-nowrap"><Link href="/dealer-cabinet">← Кабинет компании</Link><a href="#clients">Клиенты</a><a href="#contracts">Документы</a><a href="#document-trash">Архив</a></nav><h1 className="text-3xl font-black">Клиенты и документы</h1><p className="mt-2 text-sm text-[var(--ac-muted)]">Данные доступны только подтверждённым сотрудникам вашей компании. Если клиент ещё не отображается, назначьте менеджера и выберите результат общения в заявке. Редактируйте свои договоры и прикрепляйте готовые версии к клиентам.</p><section id="clients" className="my-6"><DealerClientForm/>{clients.map(c=><details key={c.id} id={c.id} className="my-4 rounded-2xl border border-[var(--ac-border)] p-4"><summary className="cursor-pointer font-bold">{c.fio} · {c.phone} {c.city&&`· ${c.city}`}</summary><div className="mt-4"><ClientDocuments apiBase="/api/dealers/clients" clientId={c.id} documents={(c.documents||[]).filter((d:ClientDocument)=>!d.deletedAt)} trashHref="#document-trash"/><CustomerAccess clientId={c.id} documents={c.documents||[]} leads={leadsByClient.get(c.id)||[]}/></div></details>)}{!clients.length&&<p className="mt-4">Добавьте первого клиента, чтобы прикреплять к нему файлы и договоры.</p>}</section><section id="contracts"><h2 className="mb-3 text-2xl font-bold">Документы компании</h2><p className="mb-4 text-sm text-[var(--ac-muted)]">Перед использованием проверьте текст шаблона, исполнителя, реквизиты и город. Изменения шаблонов вашей компании не затрагивают других дилеров.</p><ContractWorkspace endpoint="/api/dealers/contracts" owner clients={clients.map(c=>({id:c.id,name:c.fio,phone:c.phone||'',city:c.city||''}))}/></section><DocumentTrash apiBase="/api/dealers/clients" entries={trash} clientBase="/dealer-cabinet/documents#"/></div></main>;
}
