import {CrmLeadCard} from '@/components/crm/CrmLeadCard';
import {CrmLeadSummary,CrmLeadLayoutToggle,CRM_LEAD_CARD_CLASS} from '@/components/crm/CrmRecordViews';
import {LeadFilters,CollapseLead} from "@/components/crm/LeadFilters";
import {leadColumn} from "@/lib/crm-lead-board";
import {LeadBoard} from "@/components/crm/LeadBoard";
import {LeadNotes} from "@/components/crm/LeadNotes";
import {groupCrmLeads} from "@/lib/crm-customer-group";
import {clientRegistrationAvatars} from "@/lib/account/crm-registration";
import {leadDealerId} from '@/lib/dealers/lead-routing';
import {isPlatformOwner} from '@/lib/platform-access';
import {leadChannelLabel} from "@/lib/lead-source";
import {DeleteCrmRecord} from "@/components/crm/DeleteCrmRecord";
import {TeamDiscussion} from "@/components/crm/TeamDiscussion";
import {discussionMessages,discussionLabel} from "@/lib/crm-discussion";
import {ReminderButton} from "@/components/crm/Reminders";
import {hasCrmPermission} from "@/lib/crm-permissions";
import {ManualClientOrigin} from "@/components/crm/ManualClientOrigin";
import {manualClientIndex} from "@/lib/crm-client-origin";
import {ContactIcon} from "@/components/crm/ContactIcon";
import { LeadStatusHelp } from "@/components/crm/LeadStatusHelp";
import { LeadReadStatus } from "@/components/crm/LeadReadStatus";
import { leadReadState } from "@/lib/crm-read-state";
import Link from "next/link";
import {DocumentTrash} from "@/components/crm/DocumentTrash";
import {leadContact} from "@/lib/lead-contact";
import {canSeeLead} from "@/lib/crm-visibility";
import {LeadContact} from "@/components/crm/LeadContact";
import {followupText} from "@/lib/crm-notifications";
import { redirect } from "next/navigation";
import { CrmShell } from "@/components/crm/CrmShell";
import { LeadActions } from "@/components/crm/LeadActions";
import { LeadClientGroup } from "@/components/crm/LeadClientGroup";
import { ManualLeadForm } from "@/components/crm/ManualLeadForm";
import { readChunkedDataJson } from "@/lib/data";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { readCrmUsers } from "@/lib/crm-users";
import { filterLeads } from "@/lib/crm-visibility";
import { LEAD_STATUSES, leadStatusLabel, leadStatusOptionLabel, leadMetrikaStage } from "@/lib/crm";
export const dynamic = "force-dynamic";
const first = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value || "";
const rub = (value: any) =>
  Number(value) > 0 ? `${Number(value).toLocaleString("ru-RU")} ₽` : "";
const date = (value: any) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Novokuznetsk",
      }).format(new Date(value))
    : "";
function offers(lead: any) {
  return lead.selectedOffers?.length
    ? lead.selectedOffers
    : lead.offerSnapshot
      ? [lead.offerSnapshot]
      : lead.offerId
        ? [
            {
              id: lead.offerId,
              title: lead.offerTitle || lead.car,
              image: lead.offerImageUrl,
              href: lead.offerUrl,
            },
          ]
        : [];
}
function safeHref(value: any) {
  try {
    const url = new URL(String(value), "https://avtocena.com");
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
const sourceLabel = (value: string) =>
  (
    ({
      privacy_request: "Обращение по персональным данным",
      catalog_offer: "Карточка автомобиля",
      catalog_offer_request: "Карточка автомобиля",
      offer_lead_banner: "Карточка автомобиля",
      home_lead_banner: "Главная",
      model_calculation_request: "Запрос модели",
      favorites_request: "Избранное",
      telegram_bot: "Telegram",
      telegram_bot_site_request: "Форма подбора",
      results: "Результаты подбора",
      manual_crm: "Создана менеджером",
    }) as Record<string, string>
  )[value] || "Форма заявки";
export default async function CrmLeadsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = (await searchParams) || {};
  const view = first(params.view) === "dealers" && !isPlatformOwner(user) ? "all" : first(params.view) || "all";
  const dealerFilter=first(params.dealer);
  const [stored, users, messages, deliveries, clients] = await Promise.all([
    readChunkedDataJson<any>("leads/leads.json", []),
    readCrmUsers(),
    readChunkedDataJson<any>("telegram/crm-messages.json", []),
    readChunkedDataJson<any>("telegram/crm-outbox.json", []),
    readChunkedDataJson<any>("clients/clients.json", []),
  ]);
  const previousManualClient = manualClientIndex(clients.filter(client=>canSeeLead(user,client)));
  const managers = users
    .filter(
      (user) =>
        user.status !== "disabled" &&
        ["owner", "admin", "manager"].includes(user.role),
    )
    .map((user) => ({ id: user.id, displayName: user.displayName }));
  const leads = filterLeads(stored, user, {
    view,
    status: first(params.status),
    manager: first(params.manager),
    q: first(params.q),
    date: first(params.date),
  }).filter(lead=>view==='dealers'?leadDealerId(lead)!=='dealer_topavto'&&(!dealerFilter||leadDealerId(lead)===dealerFilter):view==='archive'||leadDealerId(lead)==='dealer_topavto').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const id = first(params.id);
  const groups = groupCrmLeads(leads, clients);
  const visibleGroups = id
    ? groupCrmLeads(stored.filter(lead => lead.id === id && canSeeLead(user,lead)), clients)
    : groups.slice(0, 100);
  const board = !id && first(params.layout) === "board" && view !== "archive";
  const layoutHref=(layout:string)=>`/crm/leads?${new URLSearchParams({...Object.fromEntries(Object.entries(params).filter(([k])=>k!=="id").map(([k,v])=>[k,first(v)])),layout})}`;
  const visible = visibleGroups.flat();
  const visibleLeadIds=new Set(visible.map(lead=>lead.id));
  const messagesByLead=new Map<string,any[]>(),deliveriesByLead=new Map<string,any[]>();
  for(const message of messages)if(visibleLeadIds.has(message.leadId)){
    const rows=messagesByLead.get(message.leadId)||[];rows.push(message);messagesByLead.set(message.leadId,rows);
  }
  for(const rows of messagesByLead.values())rows.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  for(const item of deliveries)if(visibleLeadIds.has(item.leadId)){
    const rows=deliveriesByLead.get(item.leadId)||[];rows.push(item);deliveriesByLead.set(item.leadId,rows);
  }
  const usersById=new Map(users.map(user=>[user.id,user]));
  const visibleClientIds=new Set(visible.map(lead=>lead.clientId).filter(Boolean));
  const registrationAvatars=await clientRegistrationAvatars(clients.filter(client=>visibleClientIds.has(client.id)&&canSeeLead(user,client)));
  const trashClients=view==="archive"?clients.filter(client=>canSeeLead(user,client)):[];
  const trashEntries=trashClients.flatMap(client=>(client.documents||[]).filter((doc:any)=>doc.deletedAt).map((document:any)=>({clientId:client.id,clientName:client.fio||"Клиент",document})));
  return (
    <CrmShell
      activeHref="/crm/leads"
      title="Заявки"
      subtitle="Обращения клиентов, автомобили и работа команды. Время Новокузнецка."
    >
      <div className={`crm-lead-tabs mb-4 flex flex-wrap gap-2${user.role === "owner" ? " crm-lead-tabs-owner" : ""}`}>
        {[
          ["all", "Активные"],
          ...(isPlatformOwner(user)?[["dealers", "Заявки дилеров"]]:[]),
          ["archive", "Архив"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`/crm/leads?${new URLSearchParams({view: key, ...(first(params.date) ? {date: first(params.date)} : {})})}`}
            className={`rounded-xl px-4 py-2 text-sm font-bold ${view === key ? "bg-red-500 text-white" : "border border-[var(--ac-border)]"}`}
          >
            {label}{key==="dealers"&&stored.some(l=>canSeeLead(user,l)&&leadDealerId(l)!=="dealer_topavto"&&!l.archivedAt&&!l.assignedManagerId)&&<span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{stored.filter(l=>canSeeLead(user,l)&&leadDealerId(l)!=="dealer_topavto"&&!l.archivedAt&&!l.assignedManagerId).length}</span>}
          </Link>
        ))}

      </div>
      <ManualLeadForm offices={user.workAddresses||[]} headerBefore={<CrmLeadLayoutToggle listHref={layoutHref('list')} boardHref={layoutHref('board')} board={board}/>} headerAside={
      <LeadFilters key={JSON.stringify(params)} count={["q","status","manager","date","dealer"].filter(key=>first(params[key])).length}>
      <form className="crm-lead-filters mb-4 grid gap-2 rounded-2xl bg-[var(--ac-surface-2)] p-3 md:grid-cols-[2fr_1fr_1fr_auto]">
        <input type="hidden" name="view" value={view==="my"?"all":view} />
        <input type="hidden" name="layout" value={board?"board":"list"} />
        {view==='dealers'&&<select name="dealer" aria-label="Фильтр дилера" defaultValue={dealerFilter} className="soft-input rounded-xl p-3"><option value="">Все дилеры</option>{Array.from(new Map(stored.filter(l=>canSeeLead(user,l)&&leadDealerId(l)!=='dealer_topavto').map(l=>[leadDealerId(l),l.requestedDealerName||leadDealerId(l)])).entries()).map(([id,name])=><option key={id} value={id}>{String(name)}</option>)}</select>}
        <label className="crm-filter-date">Дата заявки<input className="soft-input rounded-xl p-3" type="date" name="date" defaultValue={first(params.date)} /></label>
        <input
          name="q"
          aria-label="Поиск заявок"
          defaultValue={first(params.q)}
          placeholder="Клиент, телефон, автомобиль…"
          className="soft-input min-w-0 rounded-xl p-3"
        />
        <select
          name="status"
          aria-label="Фильтр статуса"
          defaultValue={first(params.status)}
          className="soft-input min-w-0 rounded-xl p-3"
        >
          <option value="">Все статусы</option>
          {LEAD_STATUSES.map((status) => (
            <option key={status} value={status}>
              {leadStatusOptionLabel(status)}
            </option>
          ))}
        </select>
        <select
          name="manager"
          aria-label="Фильтр менеджера"
          defaultValue={view==="my"?user.id:first(params.manager)}
          className="soft-input min-w-0 rounded-xl p-3"
        >
          <option value="">Все ответственные</option>
          <option value={user.id}>Мои заявки</option>
          <option value="unassigned">Без ответственного</option>
          {managers.filter(manager=>manager.id!==user.id).map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.displayName}
            </option>
          ))}
        </select>
        <button className="rounded-xl bg-red-500 px-5 py-3 font-bold text-white">
          Найти
        </button>
      </form>
      <Link href={`/crm/leads?${new URLSearchParams({view,layout:board?"board":"list"})}`} className="crm-filter-reset">Сбросить фильтры</Link>
      <div className="crm-filter-help"><LeadStatusHelp /></div>
      </LeadFilters>} />
      {board&&<LeadBoard groups={visibleGroups} managers={managers} avatars={Object.fromEntries(registrationAvatars)}/>}
      <div className={`mt-4 space-y-3${board?" hidden":""}`}>
        {visibleGroups.map(group => <LeadClientGroup key={group[0].id} grouped={group.length > 1} heading={<>
            <div className="min-w-0"><strong>{group[0].name || group[0].telegramDisplayName || "Клиент"}</strong><div className="mt-1 text-sm text-[var(--ac-muted)]"><LeadContact lead={group[0]} /></div></div>
            <div className="min-w-0 flex-1 px-3 text-sm">{Array.from(new Set(group.map(lead => offers(lead)[0]?.title || lead.car || "Подбор автомобиля"))).join(" · ")}</div>
            <div className="text-right text-xs text-[var(--ac-muted)]"><div>{date(group[0].createdAt)}</div><strong className="mt-2 block">Заявок: {group.length}</strong></div>
          </>}>
          <div className={group.length > 1 ? "space-y-3 border-t border-[var(--ac-border)] p-3" : ""}>{group.map((lead) => {
          const priorClient = previousManualClient(lead);
          const cars = offers(lead);
          const car = cars[0];
          const leadMessages = messagesByLead.get(lead.id)||[];
          const notifications = deliveriesByLead.get(lead.id)||[];
          const manager = usersById.get(lead.assignedManagerId);
          return (
            <CrmLeadCard lead={lead} id={id} user={user} users={users} managers={managers} registrationAvatars={registrationAvatars} priorClient={priorClient} leadMessages={leadMessages} notifications={notifications}/>

          );
        })}</div></LeadClientGroup>)}
        {!visible.length && (
          <div className="rounded-2xl border border-[var(--ac-border)] p-8 text-center text-[var(--ac-muted)]">
            Заявок по этим условиям нет.
          </div>
        )}
      </div>
      {view==="archive"&&<DocumentTrash entries={trashEntries} />}
    </CrmShell>
  );
}
