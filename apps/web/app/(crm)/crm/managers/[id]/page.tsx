import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmShell } from "@/components/crm/CrmShell";
import { readCrmUsers } from "@/lib/crm-users";
import { defaultManagerAvatar } from "@/lib/default-avatars";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value || "";
}

export default async function CrmManagerEditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<SearchParams> }) {
  const { id } = await params;
  const query: SearchParams = (await searchParams) || {};
  const isNew = id === "new";
  const users = await readCrmUsers();
  const user = isNew ? null : users.find((item) => item.id === id);
  if (!isNew && !user) notFound();
  const state = first(query.state);
  const message = first(query.message);
  const avatar = user?.avatarUrl || defaultManagerAvatar(user?.id || user?.telegramUsername || id);

  return (
    <CrmShell activeHref="/crm/managers" title={isNew ? "Новый сотрудник" : user!.displayName} subtitle="Telegram username является пропуском в CRM. Роль и доступ можно изменить в любой момент.">
      <div className="mb-4"><Link href="/crm/managers" className="text-sm font-black text-red-300">← Назад к команде</Link></div>
      {state === "saved" ? <div className="mb-4 rounded-2xl bg-emerald-400/12 px-4 py-3 text-sm font-black text-emerald-300">Сотрудник сохранён. Войти сможет после подтверждения через Telegram.</div> : null}
      {state === "error" ? <div className="mb-4 rounded-2xl bg-red-500/15 px-4 py-3 text-sm font-black text-red-200">{message || "Не удалось сохранить сотрудника."}</div> : null}

      <form action="/api/crm/users" method="post" className="glass grid gap-5 rounded-[1.8rem] p-5 md:grid-cols-[180px_minmax(0,1fr)] md:p-6">
        <input type="hidden" name="userId" value={user?.id || ""} />
        <div>
          <img src={avatar} alt="" className="h-32 w-32 rounded-[2rem] object-cover" referrerPolicy="no-referrer" />
          <div className="mt-3 text-xs font-bold leading-5 text-white/45">До первого входа показывается фирменная аватарка. После подтверждения Telegram она автоматически заменится фотографией профиля.</div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42">Имя сотрудника<input required name="displayName" defaultValue={user?.displayName || ""} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal" /></label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42">Telegram username<input required name="telegramUsername" defaultValue={user?.telegramUsername ? `@${user.telegramUsername}` : ""} placeholder="@username" className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal" /></label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42">Роль<select name="role" defaultValue={user?.role || "manager"} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal"><option value="manager">Менеджер</option><option value="admin">Администратор</option><option value="owner">Владелец</option></select></label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42">Статус<select name="status" defaultValue={user?.status || "active"} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal"><option value="active">Доступ разрешён</option><option value="disabled">Доступ отключён</option></select></label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[.08em] text-white/42 md:col-span-2">Компания<input name="companyId" defaultValue={user?.companyId || "dealer_topavto"} className="soft-input rounded-xl px-4 py-3 text-sm font-black normal-case tracking-normal" /></label>
          {user?.telegramId ? <div className="rounded-xl bg-emerald-400/10 px-4 py-3 text-sm font-bold text-emerald-300 md:col-span-2">Telegram подтверждён · ID {user.telegramId}</div> : <div className="rounded-xl bg-amber-400/10 px-4 py-3 text-sm font-bold text-amber-100 md:col-span-2">Ожидается первый вход через Telegram. После него сохранятся Telegram ID и аватар.</div>}
          <button className="dealer-primary-button rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black text-white md:col-span-2">{isNew ? "Добавить сотрудника" : "Сохранить сотрудника"}</button>
        </div>
      </form>
    </CrmShell>
  );
}
