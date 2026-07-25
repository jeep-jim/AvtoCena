import { CrmShell } from "@/components/crm/CrmShell";
import { SimpleMarketSettingsPanel } from "@/components/crm/settings/SimpleMarketSettingsPanel";
import { getCurrentUser } from "@/lib/auth";
import { getMarketsWithEffectiveVersions } from "@/lib/business-settings";
import { canEditBusinessSettings } from "@/lib/settings-validation";

export const dynamic = "force-dynamic";

export default async function CrmSettingsPage() {
  const user = getCurrentUser();
  const canEdit = canEditBusinessSettings(user?.role);
  const markets = await getMarketsWithEffectiveVersions();

  return (
    <CrmShell
      activeHref="/crm/settings"
      title="Рынки и расчёт"
      subtitle="Только значения, которые участвуют в расчёте цены автомобиля. Договоры, CPA, выплаты и технические настройки убраны из рабочего интерфейса."
    >
      <SimpleMarketSettingsPanel markets={markets} canEdit={canEdit} />
    </CrmShell>
  );
}
