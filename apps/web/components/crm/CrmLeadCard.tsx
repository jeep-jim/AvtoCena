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
const isAdminRole=(role:string)=>role==='owner'||role==='admin';
import { readCrmUsers } from "@/lib/crm-users";
import { filterLeads } from "@/lib/crm-visibility";
import { LEAD_STATUSES, leadStatusLabel, leadStatusOptionLabel, leadMetrikaStage } from "@/lib/crm";
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
export function CrmLeadCard({lead,id,user,users=[],managers=[],registrationAvatars=new Map(),priorClient,leadMessages=[],notifications=[],apiBase='/api/crm',clientBase='/crm/clients',actions,dealer=false}:{lead:any;id?:string;user:import('@/lib/auth').AuthUser;users?:any[];managers?:any[];registrationAvatars?:Map<string,string>;priorClient?:any;leadMessages?:any[];notifications?:any[];apiBase?:string;clientBase?:string;actions?:React.ReactNode;dealer?:boolean}){
 const cars=offers(lead),car=cars[0],manager=users.find(u=>u.id===lead.assignedManagerId),canEdit=dealer||hasCrmPermission(user,'editLeads');
 return (
            <details
              key={lead.id}
              id={lead.id}
              open={id === lead.id}
              className={CRM_LEAD_CARD_CLASS}
            >
              <CrmLeadSummary>
                {car?.image ? (
                  <img
                    src={safeHref(car.image)}
                    alt=""
                    className="crm-lead-car-image h-16 w-16 rounded-xl object-cover md:w-20"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="crm-lead-car-image grid h-16 w-16 place-items-center rounded-xl bg-[var(--ac-surface)] text-2xl">
                    🚘
                  </div>
                )}
                <div className="crm-lead-identity min-w-0">
                  <div className="crm-lead-name font-black">
                    {registrationAvatars.has(lead.clientId)&&<img src={registrationAvatars.get(lead.clientId)} alt="Есть личный кабинет" title="Есть личный кабинет" width={32} height={32} loading="lazy" className="inline-block h-8 w-8 shrink-0 rounded-full object-cover align-middle mr-2"/>}
                    {lead.clientId ? <Link className="crm-lead-client-link" href={`${clientBase}/${encodeURIComponent(lead.clientId)}`} title="Открыть карточку клиента">{lead.name || lead.telegramDisplayName || "Клиент"}</Link> : (lead.name || lead.telegramDisplayName || "Клиент")}
                  {priorClient&&<Link href={`/crm/clients/${encodeURIComponent(priorClient.id!)}`} title="Открыть ранее добавленного клиента"><ManualClientOrigin client={priorClient} managers={users} previous/></Link>}
                  </div>
                  {leadDealerId(lead)!=='dealer_topavto'&&<div className="mt-1 text-xs font-bold text-blue-500">Дилер: {lead.requestedDealerName||leadDealerId(lead)}</div>}
                  <div className="crm-lead-contact-row mt-1 text-sm text-[var(--ac-muted)]">
                    <span className="crm-lead-channel-icon" aria-hidden="true"><ContactIcon channel={leadContact(lead).channel}/></span>
                    <LeadContact lead={lead} />
                  </div>
                </div>
                <div className="crm-lead-car-data col-span-2 min-w-0 md:col-span-1">
                  <div className="truncate text-sm font-bold">
                    {car?.title || lead.car || "Подбор автомобиля"}
                  </div>
                  <div className="mt-1 text-xs text-[var(--ac-muted)]">
                    {rub(car?.totalRub || lead.totalRub || lead.budgetRub) ||
                      lead.city ||
                      "Расчёт уточняется"}
                  </div>
                </div>
                <div className="crm-lead-status text-xs">
                  <span
                    data-metrika-stage={leadMetrikaStage(lead.status)?.tone}
                    title={leadMetrikaStage(lead.status) ? `Цель Метрики: ${leadMetrikaStage(lead.status)?.name}` : undefined}
                    data-stage={leadColumn(lead.status)}
                    className="crm-stage-badge inline-block rounded-lg px-2 py-1 font-bold"
                  >
                    {leadMetrikaStage(lead.status)?.marker} {leadStatusLabel(lead.status)}
                  </span>
                  <div className="crm-lead-manager mt-2 text-[var(--ac-muted)]">
                    {manager?.displayName || "Без ответственного"}
                  </div>
                </div>
                <div className="crm-lead-meta text-right text-xs text-[var(--ac-muted)]">
                  {date(lead.createdAt)}
                  <div className="mt-2 flex items-center justify-end gap-2 font-bold">
                    {lead.followups?.length ? <span className="crm-followup-count" aria-label={`Дополнений: ${lead.followups.length}`} title={`Дополнений: ${lead.followups.length}`}>{lead.followups.length}</span> : null}
                    <span className="crm-lead-open-label">Открыть ↓</span><span className="crm-lead-close-label">Свернуть ↑</span>
                  </div>
                </div>
              </CrmLeadSummary>
              <div className="border-t border-[var(--ac-border)] p-4 md:p-5">
                <CollapseLead/>
                <div className="crm-lead-detail-grid">
                  <section className="crm-lead-detail-info">
                    {!dealer&&<LeadReadStatus leadId={lead.id} userId={user.id} eventKey={leadReadState(lead,user.id).eventKey} initialReceipts={lead.readReceipts||[]} />}
                    <h2 className="mb-3 font-black">Автомобиль и контакты</h2>
                    <p className="mb-3 text-sm">Офис первого обращения: {lead.createdOffice||"не указан"}</p>
                    <LeadNotes apiBase={apiBase} leadId={lead.id} clientNotes={lead.clientNotes||""} vehicleNotes={lead.vehicleNotes||""} canEdit={canEdit}/>
                    <div className="grid gap-3">
                      {cars.map((offer: any, index: number) => (
                        <div
                          key={offer.id || index}
                          className="flex gap-3 rounded-xl bg-[var(--ac-surface)] p-3"
                        >
                          {offer.image && (
                            <img
                              src={safeHref(offer.image)}
                              alt=""
                              className="h-20 w-24 rounded-lg object-cover"
                              referrerPolicy="no-referrer"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="font-bold">
                              {offer.title || lead.car}
                            </div>
                            <div className="my-1 text-sm text-[var(--ac-muted)]">
                              {[offer.marketLabel, offer.year]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                            <div className="text-sm">
                              {rub(offer.totalRub) || "Расчёт уточнит менеджер"}
                            </div>
                            {(offer.href || offer.id) && (
                              <a
                                href={safeHref(
                                  offer.href ||
                                    `/cars/offer/${encodeURIComponent(offer.id)}`,
                                )}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 inline-block text-sm font-bold underline"
                              >
                                Открыть автомобиль ↗
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                      {!cars.length && (
                        <p className="text-sm text-[var(--ac-muted)]">
                          {lead.car || "Подбор автомобиля"}. Конкретное
                          объявление не сохранено.
                        </p>
                      )}
                    </div>
                    <div className="my-4 flex flex-wrap gap-3 text-sm font-bold">
                      <LeadContact lead={lead} interactive />
                      <span>{lead.city}</span>
                    </div>
                    {lead.comment && (
                      <p className="whitespace-pre-wrap rounded-xl bg-[var(--ac-surface)] p-3 text-sm">
                        <strong className="mb-1 block text-xs">Комментарий при создании заявки</strong>
                        {lead.comment}
                      </p>
                    )}
                    {!dealer&&<div className="mt-3 text-xs text-[var(--ac-muted)]">
                      {leadChannelLabel(lead)} · {sourceLabel(lead.source)} · {date(lead.createdAt)}
                      <br />
                      Уведомления:{" "}
                      {notifications.length
                        ? `${notifications.filter((item) => item.status === "sent").length} доставлено из ${notifications.length}`
                        : lead.notificationRequestedAt
                          ? "Ожидает отправки в группу"
                          : "Историческая заявка"}
                    </div>
                    }
                    {lead.archivedAt && (
                      <p className="mt-3 text-sm">
                        В архиве: {lead.archiveReason || "Без причины"} ·{" "}
                        {date(lead.archivedAt)}
                      </p>
                    )}
                  </section>
                  <section className="crm-lead-detail-chat">
                    <TeamDiscussion apiBase={apiBase} type="lead" entityId={lead.id} label={discussionLabel('lead',lead)} initialMessages={discussionMessages(lead)} userId={user.id} canReply={canEdit}/>
                    <details className="crm-external-history mt-4"><summary className="font-bold">История статусов и сообщения клиента</summary>
                    <div className="max-h-80 space-y-2 overflow-y-auto">
                      {[
                        ...(lead.followups || []).map((entry: any) => ({text: followupText(entry), createdAt: entry.createdAt, author: `Клиент · ${leadChannelLabel(entry)} · дополнение`})),
                        ...(lead.statusHistory || []).map((entry: any) => ({
                          text: `Статус: ${leadStatusLabel(entry.status)}${entry.note ? ` · ${entry.note}` : ""}`,
                          createdAt: entry.changedAt,
                          author: entry.changedByName,
                        })),
                        ...leadMessages.map((entry: any) => ({
                          text: entry.text,
                          createdAt: entry.createdAt,
                          author:
                            entry.direction === "in"
                              ? "Клиент"
                              : entry.managerName || "Менеджер",
                        })),
                      ]
                        .sort((a, b) =>
                          String(a.createdAt).localeCompare(
                            String(b.createdAt),
                          ),
                        )
                        .map((entry, index) => (
                          <div
                            key={index}
                            className="rounded-xl bg-[var(--ac-surface)] p-3"
                          >
                            <div className="mb-1 text-xs text-[var(--ac-muted)]">
                              {entry.author} · {date(entry.createdAt)}
                            </div>
                            <p className="whitespace-pre-wrap text-sm">
                              {entry.text}
                            </p>
                          </div>
                        ))}
                    </div>
                    <p className="mt-3 text-xs text-[var(--ac-muted)]">
                      {dealer?'Ответ клиенту доступен в разделе «Чат» после подключения его кабинета.':'Ответ клиенту через служебную кнопку в боте.'} Внутренние заметки клиенту не отправляются.
                    </p>
                    </details>
                  </section>
                </div>
                <div className="crm-lead-detail-actions mt-5">
    {!dealer&&hasCrmPermission(user,"deleteRecords")?<DeleteCrmRecord kind="lead" id={lead.id}/>:null}
                  <ReminderButton apiBase={apiBase} basePath={dealer?"/dealer-cabinet":"/crm"} entityType="lead" entityId={lead.id}/>
                  {actions|| (canEdit?<LeadActions
                    leadId={lead.id}
                    currentStatus={lead.status}
                    currentManagerId={lead.assignedManagerId}
                    managers={managers}
                    canAssignManagers={hasCrmPermission(user,"assign")}
                    canArchive={isAdminRole(user.role)} archived={Boolean(lead.archivedAt)}
                  />:null)}
                </div>
                <CollapseLead/>
              </div>
            </details>
 );
}
