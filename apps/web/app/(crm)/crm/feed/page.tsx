import { CrmShell } from "@/components/crm/CrmShell";
import { readChunkedDataJson } from "@/lib/data";
import { getCurrentUser } from "@/lib/auth";
import { leadStatusLabel } from "@/lib/crm";

export const dynamic = "force-dynamic";

function dateLabel(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function eventTypeLabel(event: any) {
  if (event.type === "lead_created") return "Новая заявка";
  if (event.type === "client_created") return "Новый клиент";
  if (event.type === "lead_status_changed") return `Статус: ${leadStatusLabel(event.status)}`;
  if (event.type === "lead_assigned") return "Назначение менеджера";
  if (event.type === "lead_note_added") return "Комментарий";
  return event.title || event.type || "Событие";
}

export default function CrmFeedPage() {
  const user = getCurrentUser();
  const events = readChunkedDataJson<any>("activity/feed.json", []).sort(
    (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
  );
  const myEvents = events.filter(
    (event) => event.managerId === user?.id || event.assignedManagerId === user?.id,
  );

  function EventList({ items, emptyText }: { items: any[]; emptyText: string }) {
    return (
      <div className="mt-5 space-y-3">
        {items.map((event) => (
          <div key={event.id} className="rounded-2xl bg-white/7 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-black">{event.title || eventTypeLabel(event)}</div>
              <div className="text-xs font-bold text-white/42">{dateLabel(event.createdAt)}</div>
            </div>
            <div className="mt-1 text-sm font-bold text-white/50">
              {eventTypeLabel(event)}
              {event.source ? ` · ${event.source}` : ""}
            </div>
            {event.text && <div className="mt-2 text-sm leading-6 text-white/62">{event.text}</div>}
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-white/35">
              {event.leadId && <span>lead: {event.leadId}</span>}
              {event.clientId && <span>client: {event.clientId}</span>}
              {event.managerName && <span>{event.managerName}</span>}
            </div>
          </div>
        ))}
        {!items.length && (
          <div className="rounded-2xl bg-white/7 px-4 py-5 text-sm font-bold text-white/50">
            {emptyText}
          </div>
        )}
      </div>
    );
  }

  return (
    <CrmShell title="Лента" subtitle="Заявки, назначения, статусы и внутренние действия менеджеров.">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="glass rounded-[2rem] p-5 md:p-6">
          <h2 className="text-2xl font-black">Общая лента</h2>
          <EventList items={events} emptyText="Пока нет событий." />
        </div>

        <div className="glass rounded-[2rem] p-5 md:p-6">
          <h2 className="text-2xl font-black">Моя лента</h2>
          <EventList items={myEvents} emptyText="В вашей личной ленте пока нет событий." />
        </div>
      </div>
    </CrmShell>
  );
}
