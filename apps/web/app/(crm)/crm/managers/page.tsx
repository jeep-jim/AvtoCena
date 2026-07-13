import { CrmShell } from "@/components/crm/CrmShell";
import { getAuthUsers, isCrmRole } from "@/lib/auth";
import { readChunkedDataJson } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function CrmManagersPage() {
  const managers = getAuthUsers().filter((user) => isCrmRole(user.role));
  const leads = await readChunkedDataJson<any>("leads/leads.json", []);
  const clients = await readChunkedDataJson<any>("clients/clients.json", []);

  return (
    <CrmShell activeHref="/crm/managers" title="Менеджеры" subtitle="Список сотрудников, роли, заявки и клиенты по каждому менеджеру.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {managers.map((manager) => {
          const managerLeads = leads.filter((lead) => lead.assignedManagerId === manager.id || lead.createdByManagerId === manager.id);
          const managerClients = clients.filter((client) => client.assignedManagerId === manager.id || client.createdByManagerId === manager.id);

          return (
            <article key={manager.id} className="glass rounded-[2rem] p-5">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-white text-lg font-black text-black">
                  {manager.displayName.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-xl font-black">{manager.displayName}</h2>
                  <div className="text-sm font-bold text-white/45">@{manager.telegramUsername} · {manager.role}</div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/7 p-4">
                  <div className="text-xs font-bold text-white/45">Заявки</div>
                  <div className="mt-1 text-3xl font-black">{managerLeads.length}</div>
                </div>
                <div className="rounded-2xl bg-white/7 p-4">
                  <div className="text-xs font-bold text-white/45">Клиенты</div>
                  <div className="mt-1 text-3xl font-black">{managerClients.length}</div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </CrmShell>
  );
}
