import { redirect } from "next/navigation";
import { CrmShell } from "@/components/crm/CrmShell";
import { getCurrentUser, isAdminRole } from "@/lib/auth";


export const dynamic = "force-dynamic";

export default async function CrmTelegramPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/crm/telegram");
  if (!isAdminRole(user.role)) redirect("/crm");


  return (
    <CrmShell
      activeHref="/crm/telegram"
      title="Telegram"
      subtitle="Клиентские обращения и закрытые уведомления команды через бота АвтоЦены."
    >
      <section className="glass rounded-2xl p-6">
        <h2 className="text-xl font-black">Заявки в группе «Заявки TopAvto»</h2>
        <p className="mt-3">Заявки с сайта и подтверждённые обращения из бота сохраняются в CRM и отправляются в закрытую группу. Их видят все участники группы.</p>
        <p className="mt-3">Добавляйте сотрудников в группу через Telegram. Для входа в CRM используйте логин и персональный ключ — привязка Telegram не нужна.</p>
        <p className="mt-3">Личный диалог клиента остаётся в боте. Сообщения команды в группе клиентам не отправляются.</p>
        <p className="mt-3 text-sm text-[var(--ac-muted)]">Уведомления отправляются очередью, поэтому возможна задержка. Сохранённая заявка доступна в CRM сразу после приёма.</p>
        <a className="mt-5 inline-block font-bold underline" href="/crm/leads">Открыть заявки →</a>
      </section>
    </CrmShell>
  );
}
