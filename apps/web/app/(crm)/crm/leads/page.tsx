import Link from "next/link";
import { CrmShell } from "@/components/crm/CrmShell";
import { LeadActions } from "@/components/crm/LeadActions";
import { readChunkedDataJson } from "@/lib/data";
import { getAuthUsers, getCurrentUser, isCrmRole } from "@/lib/auth";
import { money } from "@/lib/avtocena";
import { leadStatusBorderColor, leadStatusColor, leadStatusLabel } from "@/lib/crm";
import { LeadFilters } from "@/components/crm/LeadFilters";

export const dynamic = "force-dynamic";

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function managerName(managers: any[], id?: string) {
  if (!id) return "Не назначен";
  return managers.find((manager) => manager.id === id)?.displayName || id;
}

export default async function CrmLeadsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const view = firstParam(params.view) || "all";
  const user = await getCurrentUser();
  const leads = await readChunkedDataJson<any>("leads/leads.json", []);
  const managers = (await getAuthUsers()).filter((manager) => isCrmRole(manager.role));
  const q = firstParam(params.q)?.toLowerCase() || "";
  const managerId = firstParam(params.managerId) || "";
  const source = firstParam(params.source) || "";
  const status = firstParam(params.status) || "";
  const date = firstParam(params.date) || "";
  const baseLeads = view === "my" ? leads.filter((lead) => lead.assignedManagerId === user?.id || lead.createdByManagerId === user?.id) : leads;
  const visibleLeads = baseLeads.filter((lead) => (!q || [lead.name, lead.phone, lead.telegram, lead.car, lead.brand, lead.model].filter(Boolean).join(" ").toLowerCase().includes(q)) && (!managerId || lead.assignedManagerId === managerId) && (!source || (lead.source || "site") === source) && (!status || lead.status === status) && (!date || String(lead.createdAt || "").startsWith(date)));

  return (
    <CrmShell activeHref="/crm/leads" title="Лиды" subtitle="Общая лента заявок и личная очередь менеджера.">
      <LeadFilters managers={managers.map((m)=>({id:m.id,displayName:m.displayName}))} sources={[...new Set(leads.map((lead)=>lead.source||"site"))]}/><div className="mb-5 flex flex-wrap gap-2">
        <Link href={`/crm/leads?${new URLSearchParams({...Object.fromEntries(Object.entries(params).map(([k,v])=>[k, firstParam(v as any)||""])), view:"all"} as any).toString()}`} className={`rounded-full px-4 py-2 text-sm font-black ${view === "all" ? "bg-red-500 text-white" : "bg-white/10 text-white/70"}`}>Все заявки</Link>
        <Link href={`/crm/leads?${new URLSearchParams({...Object.fromEntries(Object.entries(params).map(([k,v])=>[k, firstParam(v as any)||""])), view:"my"} as any).toString()}`} className={`rounded-full px-4 py-2 text-sm font-black ${view === "my" ? "bg-red-500 text-white" : "bg-white/10 text-white/70"}`}>Мои заявки</Link>
        <Link href="/crm/clients" className="rounded-full bg-white/10 px-4 py-2 text-sm font-black text-white/70">Добавить клиента</Link>
      </div>

      <div className="glass overflow-hidden rounded-[2rem]">
        <div className="hidden grid-cols-6 gap-3 border-b border-white/10 p-4 text-xs font-black uppercase tracking-[0.14em] text-white/42 md:grid">
          <div>Клиент / даты</div><div>Авто</div><div>Бюджет</div><div>Менеджер</div><div>Источник</div><div>Статус</div>
        </div>

        {visibleLeads.map((lead) => (
          <div key={lead.id} className={`border-b border-l-4 border-b-white/7 p-4 last:border-b-0 ${leadStatusBorderColor(lead.status)}`}>
            <div className="grid gap-3 text-sm font-bold text-white/70 md:grid-cols-6">
              <div>
                <div className="font-black text-white">{lead.name || lead.phone || lead.telegram || "Без имени"}</div>
                <div className="mt-1 text-xs text-white/42">{lead.phone || lead.telegram || lead.id}</div><div className="mt-1 text-xs text-white/35">Заявка: {lead.createdAt ? new Date(lead.createdAt).toLocaleString("ru-RU") : "—"}<br/>Изменена: {lead.updatedAt ? new Date(lead.updatedAt).toLocaleString("ru-RU") : "—"}</div>
              </div>
              <div>{lead.car || [lead.brand, lead.model].filter(Boolean).join(" ") || "Не выбрано"}</div>
              <div>{lead.budgetRub ? `${money(Number(lead.budgetRub))} ₽` : "—"}</div>
              <div>{managerName(managers, lead.assignedManagerId)}</div>
              <div>{lead.partnerRef ? `ref:${lead.partnerRef}` : lead.source || "site"}</div>
              <div>
                <span className={`inline-flex rounded-full px-3 py-1 ring-1 ${leadStatusColor(lead.status)}`}>
                  {leadStatusLabel(lead.status)}
                </span>
              </div>
            </div>

            <div className="mt-4">
              <LeadActions
                leadId={lead.id}
                currentStatus={lead.status}
                currentManagerId={lead.assignedManagerId}
                managers={managers.map((manager) => ({
                  id: manager.id,
                  displayName: manager.displayName
                }))}
              />
            </div>

            {lead.rejectionReason ? (
              <div className="mt-3 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                <span className="font-black">Причина:</span> {lead.rejectionReason}
              </div>
            ) : null}
          </div>
        ))}

        {!visibleLeads.length && <div className="p-8 text-center text-sm font-bold text-white/50">Заявок пока нет.</div>}
      </div>
    </CrmShell>
  );
}
