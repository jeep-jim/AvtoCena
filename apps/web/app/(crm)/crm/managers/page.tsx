import {CrmTeamCardContent,CRM_TEAM_CARD_CLASS} from '@/components/crm/CrmRecordViews';
import {GPT_PROFILE} from "@/lib/crm-gpt-profile";
import {TeamSchedulePanel} from "@/components/crm/TeamSchedulePanel";
import {hasCrmPermission,ROLE_DETAILS} from "@/lib/crm-permissions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CrmShell } from "@/components/crm/CrmShell";
import { getCurrentUser, isAdminRole, isCrmRole } from "@/lib/auth";
import { readCrmUsers } from "@/lib/crm-users";
import { readChunkedDataJson } from "@/lib/data";
import { defaultManagerAvatar } from "@/lib/default-avatars";

export const dynamic = "force-dynamic";

const roleInfo: Record<string, { label: string; access: string }> = {
  owner: { label: "Владелец", access: "Полный доступ, пользователи, рынки и дилеры" },
  admin: { label: "Администратор", access: "Заявки, клиенты, команда, рынки и дилеры" },
  dealer: { label: "Дилер", access: "Только кабинет своей компании после подтверждения владельцем платформы" },
  manager: { label: "Менеджер", access: "Назначенные заявки, клиенты и расчёты" },
};

export default async function CrmManagersPage({searchParams}:{searchParams?:Promise<Record<string,string|string[]|undefined>>}) {
  const query=await searchParams||{};const month=typeof query.month==="string"?query.month:undefined;
  const actor=await getCurrentUser();if(!actor)redirect("/login");if(!isCrmRole(actor.role))redirect("/login");
  const [allUsers, leads, clients] = await Promise.all([
    readCrmUsers(),
    readChunkedDataJson<any>("leads/leads.json", []),
    readChunkedDataJson<any>("clients/clients.json", []),
  ]);
  const managers = allUsers.filter((user) => user.companyId === actor.companyId && isCrmRole(user.role));

  return (
    <CrmShell activeHref="/crm/managers" title="Команда и права" subtitle="Сотрудники компании, их роли, назначенные заявки и доступ к разделам CRM.">
      <TeamSchedulePanel initialMonth={month} initialDate={typeof query.date==="string"?query.date:undefined}/>
      <section className="crm-team-intro glass mb-5 rounded-[1.8rem] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black">Сотрудники ТопАвто</h2>
            {hasCrmPermission(actor,"staff") && <Link href="/crm/dealers" className="mt-2 block text-sm text-red-300">Сотрудники других компаний — в разделе «Дилеры»</Link>}

          </div>
          {hasCrmPermission(actor,"staff")?<Link href="/crm/managers/new" className="rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white">Добавить сотрудника</Link>:null}
        </div>
        <details className="crm-role-help mt-3"><summary>Роли и доступ</summary><div className="mt-3 grid gap-3 md:grid-cols-3">
          {Object.entries(roleInfo).map(([role, info]) => (
            <div key={role} className="rounded-2xl bg-white/[.045] p-4">
              <div className="text-sm font-black text-red-300">{info.label}</div>
              <div className="mt-2 text-sm font-bold leading-6 text-white/48">{ROLE_DETAILS[role]||info.access}</div>
            </div>
          ))}
        </div></details>
      </section>

      <div className="crm-team-grid grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {managers.map((manager) => {
          const managerLeads = leads.filter((lead) => !lead.archivedAt && (lead.assignedManagerId === manager.id || lead.createdByManagerId === manager.id));
          const managerClients = clients.filter((client) => client.assignedManagerId === manager.id || client.createdByManagerId === manager.id);
          const info = roleInfo[manager.role] || { label: manager.role, access: "Индивидуальные права" };
          const avatar = manager.avatarUrl || defaultManagerAvatar(manager.id || manager.telegramUsername);
          return (
            <Link key={manager.id} href={hasCrmPermission(actor,"staff")||actor.id===manager.id?`/crm/managers/${encodeURIComponent(manager.id)}`:"/crm/managers#team-schedule"} className={CRM_TEAM_CARD_CLASS}>
              <CrmTeamCardContent name={manager.displayName} login={`@${manager.telegramUsername}`} avatar={avatar} role={info.label} access={info.access} leads={managerLeads.length} clients={managerClients.length}><div className="mt-4 text-sm font-black text-red-300">Открыть →</div></CrmTeamCardContent>
            </Link>
          );
        })}
      </div>
    </CrmShell>
  );
}
