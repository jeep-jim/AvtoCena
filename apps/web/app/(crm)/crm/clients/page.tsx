import { CrmShell } from "@/components/crm/CrmShell";
import { ClientCreateForm } from "@/components/crm/ClientCreateForm";
import { readChunkedDataJson } from "@/lib/data";
import { getAuthUsers } from "@/lib/auth";

export const dynamic = "force-dynamic";

function managerName(managers: any[], id?: string) {
  if (!id) return "Не назначен";
  return managers.find((manager) => manager.id === id)?.displayName || id;
}

export default function CrmClientsPage() {
  const clients = readChunkedDataJson<any>("clients/clients.json", []);
  const managers = getAuthUsers();

  return (
    <CrmShell activeHref="/crm/clients" title="Клиенты" subtitle="Ручное добавление клиентов и карточки обращений.">
      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <ClientCreateForm />

        <div className="glass overflow-hidden rounded-[2rem]">
          <div className="border-b border-white/10 p-5">
            <h2 className="text-2xl font-black">Клиентская база</h2>
            <p className="mt-1 text-sm font-bold text-white/45">ФИО, телефон, Telegram, комментарий и назначенный менеджер.</p>
          </div>

          {clients.map((client) => (
            <div key={client.id} className="grid gap-3 border-b border-white/7 p-5 last:border-0 md:grid-cols-[1fr_180px]">
              <div>
                <div className="text-lg font-black">{client.fio || client.phone || client.telegram || "Клиент без имени"}</div>
                <div className="mt-1 text-sm font-bold text-white/50">{[client.phone, client.telegram, client.city].filter(Boolean).join(" · ") || "Контакты не указаны"}</div>
                {client.comment && <div className="mt-3 rounded-2xl bg-white/7 px-4 py-3 text-sm font-medium leading-6 text-white/62">{client.comment}</div>}
              </div>
              <div className="text-sm font-bold text-white/50">
                <div>Менеджер:</div>
                <div className="mt-1 font-black text-white/80">{managerName(managers, client.assignedManagerId)}</div>
              </div>
            </div>
          ))}

          {!clients.length && <div className="p-8 text-center text-sm font-bold text-white/50">Клиентов пока нет. Добавьте первого клиента через форму слева.</div>}
        </div>
      </div>
    </CrmShell>
  );
}
