import {crmCustomerKey} from "@/lib/crm-customer-group";
import {CustomerAccess} from "@/components/account/CustomerAccess";
import {DeleteCrmRecord} from "@/components/crm/DeleteCrmRecord";
import {TeamDiscussion} from "@/components/crm/TeamDiscussion";
import {discussionMessages,discussionLabel} from "@/lib/crm-discussion";
import {hasCrmPermission} from "@/lib/crm-permissions";
import {ReminderButton} from "@/components/crm/Reminders";
import {ManualClientOrigin} from "@/components/crm/ManualClientOrigin";
import {readCrmUsers} from "@/lib/crm-users";
import Link from "next/link";
import {ClientDocuments} from "@/components/crm/ClientDocuments";
import { notFound, redirect } from "next/navigation";
import { CrmShell } from "@/components/crm/CrmShell";
import { ClientEditForm } from "@/components/crm/ClientEditForm";
import { getCurrentUser, isCrmRole } from "@/lib/auth";
import { canSeeLead } from "@/lib/crm-visibility";
import { readChunkedDataJson } from "@/lib/data";
export const dynamic = "force-dynamic";
export default async function ClientPage({params}: {params: Promise<{id: string}>}) {
  const user = await getCurrentUser();
  if (!user || !isCrmRole(user.role)) redirect("/login");
  const {id} = await params;
  const visibleClients = (await readChunkedDataJson<any>("clients/clients.json", [])).filter(item => canSeeLead(user,item));
  const client = visibleClients.find(item => item.id === id);
  if (!client || !canSeeLead(user, client)) notFound();
  const managers = await readCrmUsers();
  const relatedClients = visibleClients.filter(item => crmCustomerKey(item) === crmCustomerKey(client));
  const relatedIds = new Set(relatedClients.map(item => item.id));
  const leads = (await readChunkedDataJson<any>("leads/leads.json", [])).filter(lead => relatedIds.has(lead.clientId) && canSeeLead(user, lead));
  return <CrmShell activeHref="/crm/clients" title={client.fio || "Карточка клиента"} subtitle="Контакты и комментарий клиента.">
    <Link href="/crm/clients" className="mb-4 inline-block font-bold text-red-400">← Все клиенты</Link>
    {hasCrmPermission(user,"deleteRecords")?<DeleteCrmRecord kind="client" id={client.id}/>:null}
    <ManualClientOrigin client={client} managers={managers}/>
    <ReminderButton entityType="client" entityId={client.id}/>
    <div className="crm-client-detail-layout">
    <ClientEditForm canEdit={hasCrmPermission(user,"editClients")} canAssign={hasCrmPermission(user,"assign")} managers={managers.map(m=>({id:m.id,displayName:m.displayName}))} client={{status:client.status||"new",assignedManagerId:client.assignedManagerId||"",id:client.id, fio:client.fio||"", phone:client.phone||"", telegram:client.telegram||"", max:client.max||"", city:client.city||"", comment:client.comment||"", updatedAt:client.updatedAt||""}}/>
    {hasCrmPermission(user,"documents")?<ClientDocuments clientId={client.id} documents={(client.documents || []).filter((doc:any)=>!doc.deletedAt)} />:null}
    </div>
    {hasCrmPermission(user,"documents")?<CustomerAccess clientId={client.id} documents={client.documents||[]} leads={leads.filter(lead=>lead.clientId===id)}/>:null}
    {relatedClients.length > 1 && <section className="mt-5 rounded-2xl border border-[var(--ac-border)] p-4"><h2 className="font-bold">История клиента</h2><p className="mt-1 text-sm text-[var(--ac-muted)]">Ранее созданные карточки с документами и заметками сохранены.</p><div className="mt-3 flex flex-wrap gap-3">{relatedClients.filter(item=>item.id!==id).map(item=><Link key={item.id} className="text-sm underline" href={`/crm/clients/${encodeURIComponent(item.id)}`}>Карточка от {new Date(item.createdAt).toLocaleDateString("ru-RU",{timeZone:"Asia/Novokuznetsk"})}</Link>)}</div></section>}
    <TeamDiscussion type="client" entityId={client.id} label={discussionLabel("client",client)} initialMessages={discussionMessages(client)} userId={user.id} canReply={hasCrmPermission(user,"editClients")}/>
    <section className="crm-client-lead-chips mt-5 flex flex-wrap gap-3"><h2 className="w-full text-xl font-black">Заявки клиента</h2>{leads.map(lead => <Link key={lead.id} href={`/crm/leads?id=${encodeURIComponent(lead.id)}`} className="glass inline-flex max-w-full items-center rounded-xl px-4 py-2">{lead.offerTitle || lead.car || "Подбор автомобиля"} →</Link>)}</section>
  </CrmShell>;
}
