import {readyDealerClients} from '@/lib/dealers/client-workflow';
import {cabinetUser} from '@/lib/dealers/cabinet-user';
import {workspaceClientsPath} from '@/lib/document-workspace';
import {workspaceCanSee,workspacePermission,sameWorkspace} from '@/lib/crm-workspace';
import {CrmPageHeading} from '@/components/crm/CrmWorkspaceFrame';
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

export async function ClientWorkspacePage({params,dealer=false}: {params: Promise<{id: string}>;dealer?:boolean}) {
  const user = dealer?await cabinetUser():await getCurrentUser();
  if (!user || (!dealer&&!isCrmRole(user.role))) redirect("/login");
  const {id} = await params;
  const visibleClients = await readyDealerClients(user,(await readChunkedDataJson<any>(workspaceClientsPath(user), [])).filter(item => workspaceCanSee(user,item,'client')));
  const client = visibleClients.find(item => item.id === id);
  if (!client || !workspaceCanSee(user, client,'client')) notFound();
  const managers = (await readCrmUsers()).filter(m=>sameWorkspace(user,m));
  const clientBase=dealer?'/dealer-cabinet/clients':'/crm/clients',leadsBase=dealer?'/dealer-cabinet/leads':'/crm/leads';
  const relatedClients = visibleClients.filter(item => crmCustomerKey(item) === crmCustomerKey(client));
  const relatedIds = new Set(relatedClients.map(item => item.id));
  const leads = (await readChunkedDataJson<any>("leads/leads.json", [])).filter(lead => relatedIds.has(lead.clientId) && workspaceCanSee(user, lead));
  const content=<>
    <Link href={dealer?"/dealer-cabinet/documents":"/crm/clients"} className="mb-4 inline-block font-bold text-red-400">← Все клиенты</Link>
    {!dealer&&workspacePermission(user,"deleteRecords")?<DeleteCrmRecord kind="client" id={client.id}/>:null}
    <ManualClientOrigin client={client} managers={managers}/>
    <ReminderButton apiBase={dealer?"/api/dealers":"/api/crm"} basePath={dealer?"/dealer-cabinet":"/crm"} entityType="client" entityId={client.id}/>
    <div className="crm-client-detail-layout">
    <ClientEditForm apiBase={dealer?"/api/dealers/clients":"/api/crm/clients"} canEdit={workspacePermission(user,"editClients")} canAssign={workspacePermission(user,"assign")} managers={managers.map(m=>({id:m.id,displayName:m.displayName}))} client={{status:client.status||"new",assignedManagerId:client.assignedManagerId||"",id:client.id, fio:client.fio||"", phone:client.phone||"", telegram:client.telegram||"", max:client.max||"", city:client.city||"", comment:client.comment||"", updatedAt:client.updatedAt||""}}/>
    {workspacePermission(user,"documents")?<ClientDocuments apiBase={dealer?"/api/dealers/clients":"/api/crm/clients"} clientId={client.id} documents={(client.documents || []).filter((doc:any)=>!doc.deletedAt)} />:null}
    </div>
    {workspacePermission(user,"documents")?<CustomerAccess clientId={client.id} documents={client.documents||[]} leads={leads.filter(lead=>lead.clientId===id)}/>:null}
    {relatedClients.length > 1 && <section className="mt-5 rounded-2xl border border-[var(--ac-border)] p-4"><h2 className="font-bold">История клиента</h2><p className="mt-1 text-sm text-[var(--ac-muted)]">Ранее созданные карточки с документами и заметками сохранены.</p><div className="mt-3 flex flex-wrap gap-3">{relatedClients.filter(item=>item.id!==id).map(item=><Link key={item.id} className="text-sm underline" href={`${clientBase}/${encodeURIComponent(item.id)}`}>Карточка от {new Date(item.createdAt).toLocaleDateString("ru-RU",{timeZone:"Asia/Novokuznetsk"})}</Link>)}</div></section>}
    <TeamDiscussion apiBase={dealer?"/api/dealers":"/api/crm"} type="client" entityId={client.id} label={discussionLabel("client",client)} initialMessages={discussionMessages(client)} userId={user.id} canReply={workspacePermission(user,"editClients")}/>
    <section className="crm-client-lead-chips mt-5 flex flex-wrap gap-3"><h2 className="w-full text-xl font-black">Заявки клиента</h2>{leads.map(lead => <Link key={lead.id} href={`${leadsBase}?id=${encodeURIComponent(lead.id)}`} className="glass inline-flex max-w-full items-center rounded-xl px-4 py-2">{lead.offerTitle || lead.car || "Подбор автомобиля"} →</Link>)}</section>
  </>;
  return dealer?<section className="dealer-cabinet-content"><CrmPageHeading title={client.fio||'Карточка клиента'} help="Контакты, документы и обсуждение клиента."/>{content}</section>:<CrmShell activeHref="/crm/clients" title={client.fio||'Карточка клиента'} subtitle="Контакты и комментарий клиента.">{content}</CrmShell>;
}
