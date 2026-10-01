import {readDataJson} from "@/lib/data";
import {StaffProfileTabs} from "@/components/crm/StaffProfileTabs";
import {StaffWorkplaces} from "@/components/crm/StaffWorkplaces";
import {TeamSchedule} from "@/components/crm/TeamSchedule";
import {StaffDocuments} from "@/components/crm/StaffDocuments";
import {readStaffProfiles} from "@/lib/crm-team";
import {hasCrmPermission} from "@/lib/crm-permissions";
import {StaffPermissions} from "@/components/crm/StaffPermissions";
import {StaffAvatarUpload} from "@/components/crm/StaffAvatarUpload";
import { StaffAccess } from "@/components/crm/StaffAccess";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CrmShell } from "@/components/crm/CrmShell";
import { readCrmUsers } from "@/lib/crm-users";
import { defaultManagerAvatar } from "@/lib/default-avatars";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value || "";
}

export default async function CrmManagerEditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<SearchParams> }) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/login");
  const { id } = await params;
  if (!hasCrmPermission(actor,"staff") && id !== actor.id) redirect("/crm");
  const query: SearchParams = (await searchParams) || {};
  const isNew = id === "new";
  const storedCompanies = await readDataJson<{id:string;name:string}[]>("dealers/dealers.json",[]);
  const companies = storedCompanies.length ? storedCompanies : [{id:"dealer_topavto",name:"TopAvto"}];
  const requestedCompany = isNew && companies.some(c=>c.id===first(query.dealer)) ? first(query.dealer) : "";
  const users = await readCrmUsers();
  const user = isNew ? null : users.find((item) => item.id === id);
  if (!isNew && !user) notFound();
  const profile=isNew?{}:(await readStaffProfiles())[id]||{};
  const state = first(query.state);
  const message = first(query.message);
  const avatar = user?.avatarUrl || defaultManagerAvatar(user?.id || user?.telegramUsername || id);

  return (
    <CrmShell activeHref="/crm/managers" title={isNew ? "Новый сотрудник" : user!.displayName} subtitle="Логин, персональный ключ и права доступа в CRM.">
      <div className="mb-4"><Link href="/crm/managers" className="text-sm font-black text-red-300">← Назад к команде</Link></div>
      {state === "saved" ? <div className="mb-4 rounded-2xl bg-emerald-400/12 px-4 py-3 text-sm font-black text-emerald-300">Сотрудник сохранён. При необходимости выдайте персональный ключ.</div> : null}
      {state === "error" ? <div className="mb-4 rounded-2xl bg-red-500/15 px-4 py-3 text-sm font-black text-red-200">{message || "Не удалось сохранить сотрудника."}</div> : null}

      <StaffProfileTabs documents={user?<StaffDocuments userId={user.id} canManage={hasCrmPermission(actor,"staff")&&(user.role!=="owner"||actor.role==="owner")}/>:undefined} schedule={user?<TeamSchedule focusUserId={user.id}/>:undefined}>
      {user && <StaffAccess userId={user.id} canManage={hasCrmPermission(actor,"staff")&&(user.role!=="owner"||actor.role==="owner")} self={actor.id===user.id}/> }
      {user&&!hasCrmPermission(actor,"staff")?<StaffAvatarUpload userId={user.id} avatar={avatar}/>:null}
      {hasCrmPermission(actor,"staff") && <form action="/api/crm/users" method="post" className="crm-staff-form grid gap-5 md:grid-cols-[180px_minmax(0,1fr)]">
        <input type="hidden" name="userId" value={user?.id || ""} />
        <div>{user?<StaffAvatarUpload userId={user.id} avatar={avatar} compact/>:<p className="text-sm text-[var(--ac-muted)]">Фото можно добавить после сохранения сотрудника.</p>}</div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42">Имя сотрудника<input required name="displayName" defaultValue={user?.displayName || ""} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal" /></label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42">Логин<input required name="telegramUsername" defaultValue={user?.telegramUsername ? `@${user.telegramUsername}` : ""} placeholder="username" className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal" /></label>
          <label className="grid gap-2 text-xs font-bold">Дата рождения<input type="date" name="birthDate" defaultValue={profile.birthDate||""} className="soft-input rounded-xl px-4 py-3"/></label>
          <label className="grid gap-2 text-xs font-bold">Личный телефон<input type="tel" name="personalPhone" autoComplete="tel" maxLength={40} defaultValue={user?.personalPhone||""} placeholder="+7 (999) 123-45-67" className="soft-input rounded-xl px-4 py-3"/><span className="text-[11px] font-normal text-[var(--ac-muted)]">Для звонков из блока команды.</span></label>
          <StaffWorkplaces addresses={user?.workAddresses} remote={user?.remoteWork}/>
          {actor.role==="owner" ? <label className="crm-permission md:col-span-2"><span><strong>🌼 Ромашка</strong><small>Копирование характеристик и стоимости из карточки автомобиля.</small></span><input type="hidden" name="offerCopyPresent" value="1"/><input type="checkbox" role="switch" name="offerCopyEnabled" defaultChecked={Boolean(user && user.offerCopyEnabled!==false)}/></label> : null}
          <StaffPermissions role={user?.role||(requestedCompany?"dealer":"manager")} permissions={user?.permissions} owner={actor.role==="owner"}/>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42">Статус<select name="status" defaultValue={user?.status || "active"} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal"><option value="active">Доступ разрешён</option><option value="disabled">Доступ отключён</option></select></label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42 md:col-span-2">Компания<select name="companyId" defaultValue={user?.companyId || requestedCompany || "dealer_topavto"} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal">{user?.companyId&&!companies.some(c=>c.id===user.companyId)&&<option value={user.companyId}>{user.companyId}</option>}{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <p className="text-sm md:col-span-2">Уведомления поступают в закрытую группу команды. Привязка личного Telegram не требуется.</p>
          <button className="dealer-primary-button rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black text-white md:col-span-2">{isNew ? "Добавить сотрудника" : "Сохранить сотрудника"}</button>
        </div>
      </form>}
      {user&&!hasCrmPermission(actor,"staff")?<div className="crm-staff-readonly"><h3>Место работы</h3>{user.workAddresses?.map(a=><p key={a}>{a}</p>)}{user.remoteWork?<p>Удалённо</p>:null}{!user.workAddresses?.length&&!user.remoteWork?<p>Место работы пока не указано.</p>:null}</div>:null}
      </StaffProfileTabs>
    </CrmShell>
  );
}
