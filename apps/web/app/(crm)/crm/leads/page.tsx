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

function dateLabel(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
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
  const managerOptions = managers.map((manager) => ({
    id: manager.id,
    displayName: manager.displayName,
  }));
  const visibleLeads = view === "my"
    ? leads.filter(
        (lead) =>
          lead.assignedManagerId === user?.id || lead.createdByManagerId === user?.id,
      )
    : leads;

  return (
    <CrmShell title="Лиды" subtitle="Общая лента заявок, назначение менеджеров и движение по воронке.">
      <div className="mb-5 flex flex-wrap gap-2">
        <a href="/crm/leads" className={`rounded-full px-4 py-2 text-sm font-black ${view === "all" ? "bg-red-500 text-white" : "bg-white/10 text-white/70"}`}>Все заявки</a>
        <a href="/crm/leads?view=my" className={`rounded-full px-4 py-2 text-sm font-black ${view === "my" ? "bg-red-500 text-white" : "bg-white/10 text-white/70"}`}>Мои заявки</a>
        <a href="/crm/clients" className="rounded-full bg-white/10 px-4 py-2 text-sm font-black text-white/70">Добавить клиента</a>
      </div>

      <div className="grid gap-4">
        {visibleLeads.map((lead) => (
          <article key={lead.id} className="glass rounded-[1.7rem] p-4 md:p-5">
            <div className="grid gap-4 md:grid-cols-[minmax(190px,1.1fr)_minmax(180px,1fr)_150px_180px_180px] md:items-start">
              <div>
                <div className="text-lg font-black text-white">
                  {lead.name || lead.phone || lead.city || lead.telegram || "Без имени"}
                </div>
                <div className="mt-1 text-xs font-bold text-white/42">
                  {[lead.phone, lead.city, lead.telegram].filter(Boolean).join(" · ") || lead.id}
                </div>
                <div className="mt-2 text-xs font-bold text-white/34">{dateLabel(lead.createdAt)}</div>
              </div>

              <div>
                <div className="font-black text-white/86">
                  {lead.car || [lead.brand, lead.model].filter(Boolean).join(" ") || "Авто не выбрано"}
                </div>
                <div className="mt-1 text-xs text-white/42">
                  {lead.marketName || lead.market || "Рынок не указан"}
                  {lead.year ? ` · ${lead.year}` : ""}
                </div>
              </div>

              <div>
                <div className="text-xs font-bold uppercase tracking-[0.12em] text-white/35">Бюджет</div>
                <div className="mt-1 font-black text-white/80">
                  {lead.budgetRub ? `${money(Number(lead.budgetRub))} ₽` : "—"}
                </div>
              </div>

              <div>
                <div className="text-xs font-bold uppercase tracking-[0.12em] text-white/35">Менеджер</div>
                <div className="mt-1 font-black text-white/80">
                  {managerName(managers, lead.assignedManagerId)}
                </div>
              </div>

              <div>
                <div className="text-xs font-bold uppercase tracking-[0.12em] text-white/35">Источник</div>
                <div className="mt-1 font-black text-white/80">
                  {lead.partnerRef ? `ref:${lead.partnerRef}` : lead.source || "site"}
                </div>
                {(lead.attribution?.sub1 || lead.attribution?.utmCampaign) && (
                  <div className="mt-1 truncate text-xs text-white/38">
                    {lead.attribution?.sub1 || lead.attribution?.utmCampaign}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/8 pt-4">
              <span className="rounded-full bg-red-500/18 px-3 py-1.5 text-xs font-black text-red-100">
                {leadStatusLabel(lead.status)}
              </span>
              <span className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-bold text-white/50">
                ID: {lead.id}
              </span>
              {lead.externalClickId && (
                <span className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-bold text-white/50">
                  click_id: {lead.externalClickId}
                </span>
              )}
            </div>

            <div className="mt-3">
              <LeadActions
                leadId={lead.id}
                currentStatus={lead.status || "new"}
                currentManagerId={lead.assignedManagerId}
                managers={managerOptions}
              />
            </div>
          </article>
        ))}

        {!visibleLeads.length && (
          <div className="glass rounded-[2rem] p-8 text-center text-sm font-bold text-white/50">
            Заявок пока нет.
          </div>
        )}
      </div>
    </CrmShell>
  );
}
