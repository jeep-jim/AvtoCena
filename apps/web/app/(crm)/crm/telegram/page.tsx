import { redirect } from "next/navigation";
import { CrmShell } from "@/components/crm/CrmShell";
import { TelegramSetupForm } from "@/components/crm/TelegramSetupForm";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { getTelegramPublicConfig } from "@/lib/telegram-config";

import { pollingEnabled } from "@/lib/crm-polling";

export const dynamic = "force-dynamic";

export default async function CrmTelegramPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/crm/telegram");
  if (!isAdminRole(user.role)) redirect("/crm");

  const external = await pollingEnabled();
  const telegram = external ? null : await getTelegramPublicConfig();

  return (
    <CrmShell
      activeHref="/crm/telegram"
      title="Telegram"
      subtitle="Клиентские обращения и закрытые уведомления команды через бота АвтоЦены."
    >
      {external ? (
        <section className="glass rounded-2xl p-6">
          <h2 className="text-xl font-black">Бот работает через GitHub</h2>
          <p className="mt-3">Команды и уведомления обрабатываются очередью. Ответ может прийти с задержкой: GitHub запускает обработчик по расписанию.</p>
          <p className="mt-3">Подключение сотрудника выполняется в его собственной карточке после входа по ключу. Общие заявки доступны подключённым владельцам и администраторам. Клиенты видят только свои обращения.</p>
          <a className="mt-5 inline-block font-bold underline" href={`/crm/managers/${encodeURIComponent(user.id)}`}>Открыть мою карточку и подключить Telegram →</a>
          <p className="mt-3 text-sm text-[var(--ac-muted)]">Повторная настройка webhook и проверка сети сервера для этого режима не требуются. Включённый режим сам по себе не подтверждает доставку заявки.</p>
        </section>
      ) : telegram ? <TelegramSetupForm initialStatus={telegram} /> : null}
    </CrmShell>
  );
}
