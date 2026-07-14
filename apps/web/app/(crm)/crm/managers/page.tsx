import Link from "next/link";
import { CrmShell } from "@/components/crm/CrmShell";
import { getAuthUsers, isCrmRole } from "@/lib/auth";
import { readChunkedDataJson } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function CrmManagersPage() {
  const managers = getAuthUsers().filter((user) => isCrmRole(user.role));
  const leads = await readChunkedDataJson<any>("leads/leads.json", []);
  const clients = await readChunkedDataJson<any>("clients/clients.json", []);
  const deals = await readChunkedDataJson<any>("deals/deals.json", []);

  return (
    <CrmShell activeHref="/crm/managers" title="Менеджеры" subtitle="Список сотрудников, роли, заявки и клиенты по каждому менеджеру.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {managers.map((manager) => {
          const managerLeads = leads.filter((lead) => lead.assignedManagerId === manager.id || lead.createdByManagerId === manager.id);
          const managerClients = clients.filter((client) => client.assignedManagerId === manager.id || client.createdByManagerId === manager.id);
          const managerDeals = deals.filter((deal) => deal.assignedManagerId === manager.id || deal.createdByManagerId === manager.id);

          return (
            <Link href={`/crm/managers/${manager.id}`} key={manager.id} className="glass block rounded-[2rem] p-5 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-red-300/60">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-white text-lg font-black text-black">
                  {manager.displayName.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-xl font-black">{manager.displayName}</h2>
                  <div className="text-sm font-bold text-white/45">@{manager.telegramUsername} · {manager.role}</div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-white/7 p-4">
                  <div className="text-xs font-bold text-white/45">Заявки</div>
                  <div className="mt-1 text-3xl font-black">{managerLeads.length}</div>
                </div>
                <div className="rounded-2xl bg-white/7 p-4">
                  <div className="text-xs font-bold text-white/45">Клиенты</div>
                  <div className="mt-1 text-3xl font-black">{managerClients.length}</div>
                </div>
              <div className="rounded-2xl bg-white/7 p-4"><div className="text-xs font-bold text-white/45">Сделки</div><div className="mt-1 text-3xl font-black">{managerDeals.length}</div></div></div>
            </Link>
          );
        })}
      </div>
    </CrmShell>
  );
}
