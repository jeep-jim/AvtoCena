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
  const client = (await readChunkedDataJson<any>("clients/clients.json", [])).find(item => item.id === id);
  if (!client || !canSeeLead(user, client)) notFound();
  const leads = (await readChunkedDataJson<any>("leads/leads.json", [])).filter(lead => lead.clientId === id && canSeeLead(user, lead));
  return <CrmShell activeHref="/crm/clients" title={client.fio || "Карточка клиента"} subtitle="Контакты и комментарий клиента.">
    <Link href="/crm/clients" className="mb-4 inline-block font-bold text-red-400">← Все клиенты</Link>
    <div className="crm-client-detail-layout">
    <ClientEditForm client={{id:client.id, fio:client.fio||"", phone:client.phone||"", telegram:client.telegram||"", max:client.max||"", city:client.city||"", comment:client.comment||"", updatedAt:client.updatedAt||""}}/>
    <ClientDocuments clientId={client.id} documents={(client.documents || []).filter((doc:any)=>!doc.deletedAt)} />
    </div>
    <section className="crm-client-lead-chips mt-5 flex flex-wrap gap-3"><h2 className="w-full text-xl font-black">Заявки клиента</h2>{leads.map(lead => <Link key={lead.id} href={`/crm/leads?id=${encodeURIComponent(lead.id)}`} className="glass inline-flex max-w-full items-center rounded-xl px-4 py-2">{lead.offerTitle || lead.car || "Подбор автомобиля"} →</Link>)}</section>
  </CrmShell>;
}
