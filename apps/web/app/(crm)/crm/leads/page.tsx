import Link from "next/link";
import { CrmShell } from "@/components/crm/CrmShell";
import { LeadActions } from "@/components/crm/LeadActions";
import { ManualLeadForm } from "@/components/crm/ManualLeadForm";
import { readChunkedDataJson } from "@/lib/data";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { readCrmUsers } from "@/lib/crm-users";
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

function dateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function contactPreferenceLabel(lead: any) {
  if (lead.contactPreference === "call") return "Позвонить";
  if (lead.contactPreference === "message") {
    if (lead.messenger === "telegram") return "Написать в Telegram";
    if (lead.messenger === "max") return "Написать в MAX";
    return "Написать";
  }
  return "Способ связи не указан";
}

function selectedOffers(lead: any) {
  if (Array.isArray(lead.selectedOffers) && lead.selectedOffers.length) return lead.selectedOffers;
  if (lead.offerSnapshot && typeof lead.offerSnapshot === "object") {
    const row = lead.offerSnapshot;
    return [{
      id: row.id || row.offerId || lead.offerId,
      offerId: row.offerId || row.id || lead.offerId,
      title: lead.offerTitle || [row.make, row.model, row.year].filter(Boolean).join(" "),
      href: lead.offerUrl || (lead.offerId ? `https://avtocena.com/cars/offer/${encodeURIComponent(lead.offerId)}` : ""),
      image: lead.offerImageUrl || row.image || "",
      marketLabel: lead.marketName || row.market || lead.market || "",
      year: row.year || lead.year,
      totalRub: row.totalRub || lead.totalRub,
    }];
  }
  return [];
}

function telegramHref(value?: string) {
  const username = String(value || "").trim().replace(/^@+/, "");
  return /^[a-zA-Z][a-zA-Z0-9_]{4,}$/.test(username) ? `https://t.me/${username}` : "";
}

function phoneHref(value?: string) {
  const normalized = String(value || "").replace(/[^+\d]/g, "");
  return normalized ? `tel:${normalized}` : "";
}

export default async function CrmLeadsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const view = firstParam(params.view) || "all";
  const user = getCurrentUser();
  const [storedLeads, managers] = await Promise.all([
    readChunkedDataJson<any>("leads/leads.json", []),
    readCrmUsers(),
  ]);
  const leads = [...storedLeads].sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
  const crmManagers = managers.filter((manager) => manager.role === "owner" || manager.role === "admin" || manager.role === "manager");
  const canAssignManagers = isAdminRole(user?.role);
  const roleVisible = canAssignManagers
    ? leads
    : leads.filter((lead) => lead.assignedManagerId === user?.id || lead.createdByManagerId === user?.id);
  const visibleLeads = view === "my"
    ? roleVisible.filter((lead) => lead.assignedManagerId === user?.id || lead.createdByManagerId === user?.id)
    : roleVisible;

  return (
    <CrmShell activeHref="/crm/leads" title="Заявки" subtitle="Новые обращения, выбранные автомобили, расчёты и работа менеджеров — в одном месте.">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link href="/crm/leads" className={`rounded-full px-4 py-2 text-sm font-black ${view === "all" ? "bg-red-500 text-white" : "bg-white/10 text-white/70"}`}>Все доступные</Link>
        <Link href="/crm/leads?view=my" className={`rounded-full px-4 py-2 text-sm font-black ${view === "my" ? "bg-red-500 text-white" : "bg-white/10 text-white/70"}`}>Мои заявки</Link>
        <Link href="/crm/clients" className="rounded-full bg-white/10 px-4 py-2 text-sm font-black text-white/70">Клиенты</Link>
      </div>

      <ManualLeadForm />

      <div className="space-y-4">
        {visibleLeads.map((lead) => {
          const offers = selectedOffers(lead);
          const tgHref = telegramHref(lead.telegram);
          const telHref = phoneHref(lead.phone);
          return (
            <article id={lead.id} key={lead.id} className="glass scroll-mt-4 overflow-hidden rounded-[2rem]">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/8 p-4 md:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-black text-white">{lead.name || lead.phone || lead.telegram || "Без имени"}</h2>
                    <span className="inline-flex rounded-full bg-red-500/20 px-3 py-1 text-xs font-black text-red-100">
                      {leadStatusLabel(lead.status)}
                    </span>
                    {lead.status === "new" ? <span className="rounded-full bg-red-500 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-white">new</span> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm font-bold text-white/60">
                    {telHref ? <a href={telHref} className="hover:text-white">☎ {lead.phone}</a> : lead.phone ? <span>☎ {lead.phone}</span> : null}
                    {tgHref ? <a href={tgHref} target="_blank" rel="noreferrer" className="hover:text-white">✈ @{String(lead.telegram).replace(/^@+/, "")}</a> : lead.telegram ? <span>✈ {lead.telegram}</span> : null}
                    {lead.max ? <span>MAX: {lead.max}</span> : null}
                    {lead.city ? <span>📍 {lead.city}</span> : null}
                    <span>{contactPreferenceLabel(lead)}</span>
                  </div>
                </div>

                <div className="text-right text-xs font-bold text-white/45">
                  <div>{dateTime(lead.createdAt)}</div>
                  <div className="mt-1">Менеджер: <span className="text-white/75">{managerName(crmManagers, lead.assignedManagerId)}</span></div>
                  <div className="mt-1">Источник: <span className="text-white/75">{lead.partnerRef ? `ref:${lead.partnerRef}` : lead.source || "site"}</span></div>
                </div>
              </div>

              <div className="p-4 md:p-5">
                {offers.length ? (
                  <div>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-black uppercase tracking-[0.12em] text-white/45">Выбранные автомобили · {offers.length}</h3>
                      {lead.budgetRub ? <div className="text-sm font-black text-white/65">Бюджет: {money(Number(lead.budgetRub))} ₽</div> : null}
                    </div>
                    <div className="grid gap-3 xl:grid-cols-2">
                      {offers.map((offer: any, index: number) => {
                        const href = offer.href || (offer.id ? `/cars/offer/${encodeURIComponent(offer.id)}` : "");
                        return (
                          <div key={offer.id || `${lead.id}-${index}`} className="flex min-w-0 gap-3 rounded-2xl border border-white/8 bg-black/15 p-3">
                            {offer.image ? <img src={offer.image} alt="" className="h-20 w-24 shrink-0 rounded-xl object-cover" referrerPolicy="no-referrer" /> : <div className="grid h-20 w-24 shrink-0 place-items-center rounded-xl bg-white/5 text-2xl">🚘</div>}
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-black text-white">{offer.title || "Автомобиль"}</div>
                              <div className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-white/45">
                                {offer.marketLabel ? <span>{offer.marketLabel}</span> : null}
                                {offer.year ? <span>{offer.year}</span> : null}
                                {offer.mileageKm ? <span>{money(Number(offer.mileageKm))} км</span> : null}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                <div className="text-base font-black text-white">{offer.totalRub ? `${money(Number(offer.totalRub))} ₽` : "Расчёт не готов"}</div>
                                {href ? <a href={href} target="_blank" rel="noreferrer" className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-black text-white/70 hover:bg-white/15 hover:text-white">Открыть авто ↗</a> : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/8 bg-black/15 p-4 text-sm font-bold text-white/55">
                    <span className="font-black text-white/75">Автомобиль:</span> {lead.car || [lead.brand, lead.model].filter(Boolean).join(" ") || "не указан"}
                    {lead.budgetRub ? <span className="ml-3">Бюджет {money(Number(lead.budgetRub))} ₽</span> : null}
                  </div>
                )}

                {lead.comment ? (
                  <div className="mt-3 rounded-2xl border border-white/8 bg-white/[0.035] p-4 text-sm text-white/70">
                    <div className="mb-1 text-xs font-black uppercase tracking-[0.12em] text-white/40">Комментарий клиента</div>
                    {lead.comment}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-white/40">
                  {lead.pageUrl ? <a href={lead.pageUrl} target="_blank" rel="noreferrer" className="hover:text-white/70">Страница заявки ↗</a> : null}
                  {lead.referrer ? <span className="max-w-full truncate">referrer: {lead.referrer}</span> : null}
                  <span>ID: {lead.id}</span>
                </div>

                <div className="mt-4">
                  <LeadActions
                    leadId={lead.id}
                    currentStatus={lead.status}
                    currentManagerId={lead.assignedManagerId}
                    managers={crmManagers.map((manager) => ({
                      id: manager.id,
                      displayName: manager.displayName
                    }))}
                    canAssignManagers={canAssignManagers}
                  />
                </div>

                {lead.rejectionReason ? (
                  <div className="mt-3 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                    <span className="font-black">Причина:</span> {lead.rejectionReason}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}

        {!visibleLeads.length ? <div className="glass rounded-[2rem] p-8 text-center text-sm font-bold text-white/50">Заявок пока нет.</div> : null}
      </div>
    </CrmShell>
  );
}
