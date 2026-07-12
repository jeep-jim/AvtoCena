import Link from "next/link";
import { CrmShell } from "@/components/crm/CrmShell";
import { LeadActions } from "@/components/crm/LeadActions";
import { readChunkedDataJson } from "@/lib/data";
import { getAuthUsers, getCurrentUser, isCrmRole } from "@/lib/auth";
import { money } from "@/lib/avtocena";
import { leadStatusLabel } from "@/lib/crm";

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
  const user = getCurrentUser();
  const leads = readChunkedDataJson<any>("leads/leads.json", []);
  const managers = getAuthUsers().filter((manager) => isCrmRole(manager.role));
  const visibleLeads = view === "my" ? leads.filter((lead) => lead.assignedManagerId === user?.id || lead.createdByManagerId === user?.id) : leads;

  return (
    <CrmShell activeHref="/crm/leads" title="Лиды" subtitle="Общая лента заявок и личная очередь менеджера.">
      <div className="mb-5 flex flex-wrap gap-2">
        <Link href="/crm/leads" className={`rounded-full px-4 py-2 text-sm font-black ${view === "all" ? "bg-red-500 text-white" : "bg-white/10 text-white/70"}`}>Все заявки</Link>
        <Link href="/crm/leads?view=my" className={`rounded-full px-4 py-2 text-sm font-black ${view === "my" ? "bg-red-500 text-white" : "bg-white/10 text-white/70"}`}>Мои заявки</Link>
        <Link href="/crm/clients" className="rounded-full bg-white/10 px-4 py-2 text-sm font-black text-white/70">Добавить клиента</Link>
      </div>

      <div className="glass overflow-hidden rounded-[2rem]">
        <div className="hidden grid-cols-6 gap-3 border-b border-white/10 p-4 text-xs font-black uppercase tracking-[0.14em] text-white/42 md:grid">
          <div>Клиент</div><div>Авто</div><div>Бюджет</div><div>Менеджер</div><div>Источник</div><div>Статус</div>
        </div>

        {visibleLeads.map((lead) => (
          <div key={lead.id} className="border-b border-white/7 p-4 last:border-0">
            <div className="grid gap-3 text-sm font-bold text-white/70 md:grid-cols-6">
              <div>
                <div className="font-black text-white">{lead.name || lead.phone || lead.telegram || "Без имени"}</div>
                <div className="mt-1 text-xs text-white/42">{lead.phone || lead.telegram || lead.id}</div>
              </div>
              <div>{lead.car || [lead.brand, lead.model].filter(Boolean).join(" ") || "Не выбрано"}</div>
              <div>{lead.budgetRub ? `${money(Number(lead.budgetRub))} ₽` : "—"}</div>
              <div>{managerName(managers, lead.assignedManagerId)}</div>
              <div>{lead.partnerRef ? `ref:${lead.partnerRef}` : lead.source || "site"}</div>
              <div>
                <span className="inline-flex rounded-full bg-red-500/20 px-3 py-1 text-red-100">
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
