import Link from "next/link";
import { redirect } from "next/navigation";
import { CrmShell } from "@/components/crm/CrmShell";
import { LeadActions } from "@/components/crm/LeadActions";
import { ManualLeadForm } from "@/components/crm/ManualLeadForm";
import { readChunkedDataJson } from "@/lib/data";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { readCrmUsers } from "@/lib/crm-users";
import { filterLeads } from "@/lib/crm-visibility";
import { LEAD_STATUSES, leadStatusLabel } from "@/lib/crm";
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
        timeZone: "Europe/Moscow",
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
      catalog_offer: "Карточка автомобиля",
      catalog_offer_request: "Карточка автомобиля",
      offer_lead_banner: "Карточка автомобиля",
      home_lead_banner: "Главная",
      model_calculation_request: "Запрос модели",
      favorites_request: "Избранное",
      telegram_bot: "Telegram",
      manual_crm: "Создана менеджером",
    }) as Record<string, string>
  )[value] || "Заявка с сайта";
export default async function CrmLeadsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = (await searchParams) || {};
  const view = first(params.view) || "all";
  const [stored, users, messages, deliveries] = await Promise.all([
    readChunkedDataJson<any>("leads/leads.json", []),
    readCrmUsers(),
    readChunkedDataJson<any>("telegram/crm-messages.json", []),
    readChunkedDataJson<any>("telegram/crm-outbox.json", []),
  ]);
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
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const id = first(params.id);
  const visible = id
    ? leads.filter((lead) => lead.id === id)
    : leads.slice(0, 100);
  return (
    <CrmShell
      activeHref="/crm/leads"
      title="Заявки"
      subtitle="Обращения клиентов, автомобили и работа команды. Время указано по Москве."
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["all", "Активные"],
          ["my", "Мои заявки"],
          ["archive", "Архив"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`/crm/leads?view=${key}`}
            className={`rounded-xl px-4 py-2 text-sm font-bold ${view === key ? "bg-red-500 text-white" : "border border-[var(--ac-border)]"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      <form className="mb-4 grid gap-2 rounded-2xl bg-[var(--ac-surface-2)] p-3 md:grid-cols-[2fr_1fr_1fr_auto]">
        <input type="hidden" name="view" value={view} />
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
              {leadStatusLabel(status)}
            </option>
          ))}
        </select>
        <select
          name="manager"
          aria-label="Фильтр менеджера"
          defaultValue={first(params.manager)}
          className="soft-input min-w-0 rounded-xl p-3"
        >
          <option value="">Все ответственные</option>
          <option value="unassigned">Без ответственного</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.displayName}
            </option>
          ))}
        </select>
        <button className="rounded-xl bg-red-500 px-5 py-3 font-bold text-white">
          Найти
        </button>
      </form>
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-sm text-[var(--ac-muted)]">
          Найдено: {leads.length}
          {leads.length > 100 ? " · показаны первые 100, уточните поиск" : ""}
        </span>
        <Link href={`/crm/leads?view=${view}`} className="text-sm underline">
          Сбросить фильтры
        </Link>
      </div>
      <ManualLeadForm />
      <div className="mt-4 space-y-3">
        {visible.map((lead) => {
          const cars = offers(lead);
          const car = cars[0];
          const leadMessages = messages
            .filter((message) => message.leadId === lead.id)
            .sort((a, b) =>
              String(a.createdAt).localeCompare(String(b.createdAt)),
            );
          const notifications = deliveries.filter(
            (item) => item.leadId === lead.id,
          );
          const manager = users.find(
            (user) => user.id === lead.assignedManagerId,
          );
          return (
            <details
              key={lead.id}
              id={lead.id}
              open={id === lead.id}
              className="group overflow-hidden rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)]"
            >
              <summary className="grid cursor-pointer list-none grid-cols-[64px_1fr] items-center gap-3 p-4 md:grid-cols-[80px_1.4fr_1.4fr_1fr_auto] [&::-webkit-details-marker]:hidden">
                {car?.image ? (
                  <img
                    src={safeHref(car.image)}
                    alt=""
                    className="h-16 w-16 rounded-xl object-cover md:w-20"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="grid h-16 w-16 place-items-center rounded-xl bg-[var(--ac-surface)] text-2xl">
                    🚘
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate font-black">
                    {lead.name || lead.telegramDisplayName || "Клиент"}
                  </div>
                  <div className="mt-1 truncate text-sm text-[var(--ac-muted)]">
                    {lead.phone ||
                      (lead.telegram
                        ? `@${lead.telegram}`
                        : "Контакт в Telegram")}
                  </div>
                </div>
                <div className="col-span-2 min-w-0 md:col-span-1">
                  <div className="truncate text-sm font-bold">
                    {car?.title || lead.car || "Подбор автомобиля"}
                  </div>
                  <div className="mt-1 text-xs text-[var(--ac-muted)]">
                    {rub(car?.totalRub || lead.totalRub || lead.budgetRub) ||
                      lead.city ||
                      "Расчёт уточняется"}
                  </div>
                </div>
                <div className="text-xs">
                  <span
                    className={`inline-block rounded-lg px-2 py-1 font-bold ${lead.status === "new" ? "bg-red-500 text-white" : "bg-[var(--ac-surface)]"}`}
                  >
                    {leadStatusLabel(lead.status)}
                  </span>
                  <div className="mt-2 text-[var(--ac-muted)]">
                    {manager?.displayName || "Без ответственного"}
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--ac-muted)]">
                  {date(lead.createdAt)}
                  <div className="mt-2 font-bold">Открыть ↓</div>
                </div>
              </summary>
              <div className="border-t border-[var(--ac-border)] p-4 md:p-5">
                <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
                  <section>
                    <h2 className="mb-3 font-black">Автомобиль и контакты</h2>
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
                      {lead.phone && (
                        <a
                          href={`tel:${String(lead.phone).replace(/[^+0-9]/g, "")}`}
                          className="underline"
                        >
                          Позвонить
                        </a>
                      )}
                      {/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(
                        lead.telegram || "",
                      ) && (
                        <a
                          href={`https://t.me/${lead.telegram}`}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          Telegram клиента
                        </a>
                      )}
                      <span>{lead.city}</span>
                    </div>
                    {lead.comment && (
                      <p className="whitespace-pre-wrap rounded-xl bg-[var(--ac-surface)] p-3 text-sm">
                        {lead.comment}
                      </p>
                    )}
                    <div className="mt-3 text-xs text-[var(--ac-muted)]">
                      {sourceLabel(lead.source)} · {date(lead.createdAt)}
                      <br />
                      Уведомления:{" "}
                      {notifications.length
                        ? `${notifications.filter((item) => item.status === "sent").length} доставлено из ${notifications.length}`
                        : lead.notificationRequestedAt
                          ? "Ожидается подключение администратора / отправка"
                          : "Историческая заявка"}
                    </div>
                    {lead.archivedAt && (
                      <p className="mt-3 text-sm">
                        В архиве: {lead.archiveReason || "Без причины"} ·{" "}
                        {date(lead.archivedAt)}
                      </p>
                    )}
                  </section>
                  <section>
                    <h2 className="mb-3 font-black">История и переписка</h2>
                    <div className="max-h-80 space-y-2 overflow-y-auto">
                      {[
                        ...(lead.statusHistory || []).map((entry: any) => ({
                          text: `Статус: ${leadStatusLabel(entry.status)}${entry.note ? ` · ${entry.note}` : ""}`,
                          createdAt: entry.changedAt,
                          author: entry.changedByName,
                        })),
                        ...(lead.internalNotes || []).map((entry: any) => ({
                          text: entry.text,
                          createdAt: entry.createdAt,
                          author: entry.createdByName || "Заметка",
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
                      Ответ клиенту через служебную кнопку в боте. Внутренние
                      заметки клиенту не отправляются.
                    </p>
                  </section>
                </div>
                <div className="mt-5">
                  <LeadActions
                    leadId={lead.id}
                    currentStatus={lead.status}
                    currentManagerId={lead.assignedManagerId}
                    managers={managers}
                    canAssignManagers={isAdminRole(user.role)}
                    archived={Boolean(lead.archivedAt)}
                  />
                </div>
              </div>
            </details>
          );
        })}
        {!visible.length && (
          <div className="rounded-2xl border border-[var(--ac-border)] p-8 text-center text-[var(--ac-muted)]">
            Заявок по этим условиям нет.
          </div>
        )}
      </div>
    </CrmShell>
  );
}
