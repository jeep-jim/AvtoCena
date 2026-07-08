import { CrmShell } from "@/components/crm/CrmShell";
import { readDataJson } from "@/lib/data";
import { getAuthUsers, getCurrentUser } from "@/lib/auth";
import { money } from "@/lib/avtocena";

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
  const leads = readDataJson<any[]>("leads/leads.json", []);
  const managers = getAuthUsers();
  const visibleLeads = view === "my" ? leads.filter((lead) => lead.assignedManagerId === user?.id || lead.createdByManagerId === user?.id) : leads;

  return (
    <CrmShell title="Лиды" subtitle="Общая лента заявок и личная очередь менеджера.">
      <div className="mb-5 flex flex-wrap gap-2">
        <a href="/crm/leads" className={`rounded-full px-4 py-2 text-sm font-black ${view === "all" ? "bg-red-500 text-white" : "bg-white/10 text-white/70"}`}>Все заявки</a>
        <a href="/crm/leads?view=my" className={`rounded-full px-4 py-2 text-sm font-black ${view === "my" ? "bg-red-500 text-white" : "bg-white/10 text-white/70"}`}>Мои заявки</a>
        <a href="/crm/clients" className="rounded-full bg-white/10 px-4 py-2 text-sm font-black text-white/70">Добавить клиента</a>
      </div>

      <div className="glass overflow-hidden rounded-[2rem]">
        <div className="hidden grid-cols-6 gap-3 border-b border-white/10 p-4 text-xs font-black uppercase tracking-[0.14em] text-white/42 md:grid">
          <div>Клиент</div><div>Авто</div><div>Бюджет</div><div>Менеджер</div><div>Источник</div><div>Статус</div>
        </div>

        {visibleLeads.map((lead) => (
          <div key={lead.id} className="grid gap-3 border-b border-white/7 p-4 text-sm font-bold text-white/70 last:border-0 md:grid-cols-6">
            <div>
              <div className="font-black text-white">{lead.name || lead.phone || lead.telegram || "Без имени"}</div>
              <div className="mt-1 text-xs text-white/42">{lead.phone || lead.telegram || lead.id}</div>
            </div>
            <div>{lead.car || [lead.brand, lead.model].filter(Boolean).join(" ") || "Не выбрано"}</div>
            <div>{lead.budgetRub ? `${money(Number(lead.budgetRub))} ₽` : "—"}</div>
            <div>{managerName(managers, lead.assignedManagerId)}</div>
            <div>{lead.partnerRef ? `ref:${lead.partnerRef}` : lead.source || "site"}</div>
            <div><span className="rounded-full bg-red-500/20 px-3 py-1 text-red-100">{lead.status || "new"}</span></div>
          </div>
        ))}

        {!visibleLeads.length && <div className="p-8 text-center text-sm font-bold text-white/50">Заявок пока нет.</div>}
      </div>
    </CrmShell>
  );
}
