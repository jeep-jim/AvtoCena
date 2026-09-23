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
  if (!isAdminRole(actor.role) && id !== actor.id) redirect("/crm");
  const query: SearchParams = (await searchParams) || {};
  const isNew = id === "new";
  const users = await readCrmUsers();
  const user = isNew ? null : users.find((item) => item.id === id);
  if (!isNew && !user) notFound();
  const state = first(query.state);
  const message = first(query.message);
  const avatar = user?.avatarUrl || defaultManagerAvatar(user?.id || user?.telegramUsername || id);

  return (
    <CrmShell activeHref="/crm/managers" title={isNew ? "Новый сотрудник" : user!.displayName} subtitle="Логин, персональный ключ и права доступа в CRM.">
      <div className="mb-4"><Link href="/crm/managers" className="text-sm font-black text-red-300">← Назад к команде</Link></div>
      {state === "saved" ? <div className="mb-4 rounded-2xl bg-emerald-400/12 px-4 py-3 text-sm font-black text-emerald-300">Сотрудник сохранён. Выдайте ему персональный ключ ниже.</div> : null}
      {state === "error" ? <div className="mb-4 rounded-2xl bg-red-500/15 px-4 py-3 text-sm font-black text-red-200">{message || "Не удалось сохранить сотрудника."}</div> : null}

      {user?<StaffAvatarUpload userId={user.id} avatar={avatar}/>:null}
      {isAdminRole(actor.role) && <form action="/api/crm/users" method="post" className="glass grid gap-5 rounded-[1.8rem] p-5 md:grid-cols-[180px_minmax(0,1fr)] md:p-6">
        <input type="hidden" name="userId" value={user?.id || ""} />
        <div>
          <img src={avatar} alt="" className="h-32 w-32 rounded-[2rem] object-cover" referrerPolicy="no-referrer" />
          <div className="mt-3 text-xs font-bold leading-5 text-white/45">Фотография сотрудника или фирменная аватарка.</div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42">Имя сотрудника<input required name="displayName" defaultValue={user?.displayName || ""} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal" /></label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42">Логин<input required name="telegramUsername" defaultValue={user?.telegramUsername ? `@${user.telegramUsername}` : ""} placeholder="username" className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal" /></label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42">Роль<select name="role" defaultValue={user?.role || "manager"} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal"><option value="manager">Менеджер</option><option value="admin">Администратор</option><option value="owner">Владелец</option></select></label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42">Статус<select name="status" defaultValue={user?.status || "active"} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal"><option value="active">Доступ разрешён</option><option value="disabled">Доступ отключён</option></select></label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42 md:col-span-2">Компания<input name="companyId" defaultValue={user?.companyId || "dealer_topavto"} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal" /></label>
          <p className="text-sm md:col-span-2">Уведомления поступают в закрытую группу команды. Привязка личного Telegram не требуется.</p>
          <button className="dealer-primary-button rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black text-white md:col-span-2">{isNew ? "Добавить сотрудника" : "Сохранить сотрудника"}</button>
        </div>
      </form>}
      {user && <StaffAccess userId={user.id} canManage={isAdminRole(actor.role)} self={actor.id === user.id} connected={Boolean(user.telegramId)} />}
    </CrmShell>
  );
}
