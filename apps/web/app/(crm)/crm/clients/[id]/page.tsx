import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmShell } from "@/components/crm/CrmShell";
import { ClientEditor } from "@/components/crm/ClientEditor";
import { ClientDocuments } from "@/components/crm/ClientDocuments";
import { readChunkedDataJson } from "@/lib/data";
import { getAuthUsers, getCurrentUser, isAdminRole } from "@/lib/auth";
import { money } from "@/lib/avtocena";

export const dynamic = "force-dynamic";
const dt=(v?:string)=>v?new Date(v).toLocaleString("ru-RU"):"—";
const historyLabel:Record<string,string>={client_created:"Клиент создан",client_updated:"Данные клиента изменены",client_archived:"Клиент архивирован",client_restored:"Клиент восстановлен",document_uploaded:"Документ загружен",document_deleted:"Документ удалён",contract_generated:"Договор сформирован"};
export default async function ClientCard({ params }: { params: { id: string } }) { const user=await getCurrentUser(); const clients=await readChunkedDataJson<any>("clients/clients.json",[]); const client=clients.find((c)=>c.id===params.id); if(!client) notFound(); if(!user || (!isAdminRole(user.role) && client.assignedManagerId!==user.id)) notFound(); const leads=(await readChunkedDataJson<any>("leads/leads.json",[])).filter((l)=>l.clientId===client.id); const deals=(await readChunkedDataJson<any>("deals/deals.json",[])).filter((d)=>d.clientId===client.id); const managers=(await getAuthUsers());
 return <CrmShell activeHref="/crm/clients" title={client.fio || "Карточка клиента"} subtitle="Рабочее редактирование, документы и история действий."><div className="grid gap-5 lg:grid-cols-[1fr_380px]"><ClientEditor client={client} managers={managers}/><aside className="space-y-5"><ClientDocuments client={client}/></aside></div><div className="mt-5 grid gap-5 lg:grid-cols-2"><section className="glass rounded-[2rem] p-6"><h2 className="text-xl font-black">Связанные лиды</h2>{leads.map((l)=><Link className="mt-3 block rounded-2xl bg-white/7 p-3 text-sm font-bold hover:bg-white/10" href={`/crm/leads?lead=${l.id}`} key={l.id}>{l.car||"Заявка"} · {historyLabel[l.status] || l.status}</Link>)}</section><section className="glass rounded-[2rem] p-6"><h2 className="text-xl font-black">Сделки</h2><p className="mt-2 text-sm font-bold text-white/45">Модуль договоров будет подключён отдельным этапом.</p>{deals.map((d)=><Link className="mt-3 block rounded-2xl bg-white/7 p-3 text-sm font-bold hover:bg-white/10" href={`/crm/deals/${d.id}`} key={d.id}>{d.number||d.id} · {d.amountRub?money(d.amountRub):"—"} ₽</Link>)}</section></div><section className="glass mt-5 rounded-[2rem] p-6"><h2 className="text-xl font-black">История действий</h2><div className="mt-4 space-y-2">{(client.history||[]).map((h:any,i:number)=><div className="rounded-2xl bg-white/7 px-4 py-3 text-sm font-bold text-white/62" key={i}>{dt(h.at)} · {h.title || historyLabel[h.type] || "Событие CRM"} · {h.operationId}</div>)}</div></section></CrmShell>;
}
