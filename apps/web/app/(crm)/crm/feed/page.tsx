import { CrmShell } from "@/components/crm/CrmShell";
import { readChunkedDataJson } from "@/lib/data";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function dateLabel(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export default function CrmFeedPage() {
  const user = getCurrentUser();
  const leads = readChunkedDataJson<any>("leads/leads.json", []).map((lead) => ({
    id: lead.id,
    createdAt: lead.createdAt,
    type: "lead",
    title: lead.name || lead.phone || lead.telegram || "Новая заявка",
    text: lead.car || lead.comment || "Заявка из сайта",
    source: lead.source || "site",
    managerId: lead.assignedManagerId || lead.createdByManagerId
  }));
  const clients = readChunkedDataJson<any>("clients/clients.json", []).map((client) => ({
    id: client.id,
    createdAt: client.createdAt,
    type: "client",
    title: client.fio || client.phone || client.telegram || "Новый клиент",
    text: client.comment || "Ручное добавление клиента",
    source: client.source || "manual",
    managerId: client.assignedManagerId || client.createdByManagerId
  }));
  const events = [...leads, ...clients].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const myEvents = events.filter((event) => event.managerId === user?.id);

  return (
    <CrmShell activeHref="/crm/feed" title="Лента" subtitle="Общая лента действий и личная лента менеджера.">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="glass rounded-[2rem] p-5 md:p-6">
          <h2 className="text-2xl font-black">Общая лента</h2>
          <div className="mt-5 space-y-3">
            {events.map((event) => (
              <div key={`${event.type}_${event.id}`} className="rounded-2xl bg-white/7 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="font-black">{event.title}</div>
                  <div className="text-xs font-bold text-white/42">{dateLabel(event.createdAt)}</div>
                </div>
                <div className="mt-1 text-sm font-bold text-white/50">{event.type} · {event.source}</div>
                <div className="mt-2 text-sm leading-6 text-white/62">{event.text}</div>
              </div>
            ))}
            {!events.length && <div className="rounded-2xl bg-white/7 px-4 py-5 text-sm font-bold text-white/50">Пока нет событий.</div>}
          </div>
        </div>

        <div className="glass rounded-[2rem] p-5 md:p-6">
          <h2 className="text-2xl font-black">Моя лента</h2>
          <div className="mt-5 space-y-3">
            {myEvents.map((event) => (
              <div key={`${event.type}_${event.id}`} className="rounded-2xl bg-white/7 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="font-black">{event.title}</div>
                  <div className="text-xs font-bold text-white/42">{dateLabel(event.createdAt)}</div>
                </div>
                <div className="mt-2 text-sm leading-6 text-white/62">{event.text}</div>
              </div>
            ))}
            {!myEvents.length && <div className="rounded-2xl bg-white/7 px-4 py-5 text-sm font-bold text-white/50">В вашей личной ленте пока нет событий.</div>}
          </div>
        </div>
      </div>
    </CrmShell>
  );
}
