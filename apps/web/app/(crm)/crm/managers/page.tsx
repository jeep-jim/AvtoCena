import Link from "next/link";
import { CrmShell } from "@/components/crm/CrmShell";
import { isCrmRole } from "@/lib/auth";
import { readCrmUsers } from "@/lib/crm-users";
import { readChunkedDataJson } from "@/lib/data";

export const dynamic = "force-dynamic";

const roleInfo: Record<string, { label: string; access: string }> = {
  owner: { label: "Владелец", access: "Полный доступ, пользователи, рынки и дилеры" },
  admin: { label: "Администратор", access: "Заявки, клиенты, команда, рынки и дилеры" },
  manager: { label: "Менеджер", access: "Назначенные заявки, клиенты и расчёты" },
};

export default async function CrmManagersPage() {
  const [allUsers, leads, clients] = await Promise.all([
    readCrmUsers(),
    readChunkedDataJson<any>("leads/leads.json", []),
    readChunkedDataJson<any>("clients/clients.json", []),
  ]);
  const managers = allUsers.filter((user) => isCrmRole(user.role));

  return (
    <CrmShell activeHref="/crm/managers" title="Команда и права" subtitle="Сотрудники компании, их роли, назначенные заявки и доступ к разделам CRM.">
      <section className="glass mb-5 rounded-[1.8rem] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black">Роли в системе</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-white/48">Добавьте Telegram username сотрудника, назначьте роль — после этого он сможет войти через свой Telegram и получит аватар профиля.</p>
          </div>
          <Link href="/crm/managers/new" className="rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white">Добавить сотрудника</Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {Object.entries(roleInfo).map(([role, info]) => (
            <div key={role} className="rounded-2xl bg-white/[.045] p-4">
              <div className="text-sm font-black text-red-300">{info.label}</div>
              <div className="mt-2 text-sm font-bold leading-6 text-white/48">{info.access}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {managers.map((manager) => {
          const managerLeads = leads.filter((lead) => lead.assignedManagerId === manager.id || lead.createdByManagerId === manager.id);
          const managerClients = clients.filter((client) => client.assignedManagerId === manager.id || client.createdByManagerId === manager.id);
          const info = roleInfo[manager.role] || { label: manager.role, access: "Индивидуальные права" };
          return (
            <Link key={manager.id} href={`/crm/managers/${encodeURIComponent(manager.id)}`} className="glass rounded-[1.6rem] p-5 transition hover:-translate-y-0.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {manager.avatarUrl ? <img src={manager.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" /> : <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-lg font-black text-black">{manager.displayName.slice(0, 1).toUpperCase()}</div>}
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-black">{manager.displayName}</h2>
                    <div className="mt-1 truncate text-sm font-bold text-white/45">@{manager.telegramUsername}</div>
                  </div>
                </div>
                <span className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-black text-red-300">{info.label}</span>
              </div>
              <div className="mt-4 rounded-2xl bg-white/[.04] p-3 text-sm font-bold leading-6 text-white/48">{info.access}</div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/[.055] p-4"><div className="text-xs font-bold text-white/45">Заявки</div><div className="mt-1 text-3xl font-black">{managerLeads.length}</div></div>
                <div className="rounded-2xl bg-white/[.055] p-4"><div className="text-xs font-bold text-white/45">Клиенты</div><div className="mt-1 text-3xl font-black">{managerClients.length}</div></div>
              </div>
              <div className="mt-4 text-sm font-black text-red-300">Открыть и редактировать →</div>
            </Link>
          );
        })}
      </div>
    </CrmShell>
  );
}
