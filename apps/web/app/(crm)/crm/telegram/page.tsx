import { redirect } from "next/navigation";
import { CrmShell } from "@/components/crm/CrmShell";
import { TelegramSetupForm } from "@/components/crm/TelegramSetupForm";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { getTelegramPublicConfig } from "@/lib/telegram-config";

export const dynamic = "force-dynamic";

export default async function CrmTelegramPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/crm/telegram");
  if (!isAdminRole(user.role)) redirect("/crm");

  const telegram = await getTelegramPublicConfig();

  return (
    <CrmShell
      activeHref="/crm/telegram"
      title="Telegram"
      subtitle="Клиентские обращения и закрытые уведомления команды через бота АвтоЦены."
    >
      <TelegramSetupForm initialStatus={telegram} />
    </CrmShell>
  );
}
