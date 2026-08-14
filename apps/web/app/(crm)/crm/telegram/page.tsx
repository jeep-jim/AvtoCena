import { redirect } from "next/navigation";
import { CrmShell } from "@/components/crm/CrmShell";
import { TelegramSetupForm } from "@/components/crm/TelegramSetupForm";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { getTelegramPublicConfig } from "@/lib/telegram-config";

export const dynamic = "force-dynamic";

export default async function CrmTelegramPage() {
  const user = getCurrentUser();
  if (!user) redirect("/login?next=/crm/telegram");
  if (!isAdminRole(user.role)) redirect("/crm");

  const telegram = await getTelegramPublicConfig();

  return (
    <CrmShell
      activeHref="/crm/telegram"
      title="Telegram"
      subtitle="Вход сотрудников, клиентские расчёты и мгновенные уведомления CRM через одного бота АвтоЦены."
    >
      <TelegramSetupForm initialStatus={telegram} />
    </CrmShell>
  );
}
