import { CrmShell } from "@/components/crm/CrmShell";
import { BusinessSettingsPanel } from "@/components/crm/settings/BusinessSettingsPanel";
import { SettingsSectionNav } from "@/components/crm/settings/SettingsSectionNav";
import { getCurrentUser } from "@/lib/auth";
import { readDataJson } from "@/lib/data";
import {
  getActiveDirectPartnerPayout,
  getActiveSiteBusinessVersion,
  getContractTemplatesSettings,
  getCpaNetworks,
  getMarketsWithEffectiveVersions,
  getSettingsChangeLog,
} from "@/lib/business-settings";
import { canEditBusinessSettings } from "@/lib/settings-validation";

export const dynamic = "force-dynamic";

export default async function CrmSettingsPage() {
  const user = getCurrentUser();
  const canEdit = canEditBusinessSettings(user?.role);
  const [markets, siteSettings, partnerProgram, cpaNetworks, contracts, changeLog, partners] = await Promise.all([
    getMarketsWithEffectiveVersions(),
    getActiveSiteBusinessVersion(),
    getActiveDirectPartnerPayout(),
    getCpaNetworks(),
    getContractTemplatesSettings(),
    getSettingsChangeLog(),
    readDataJson<any[]>("partners/partners.json", [])
  ]);

  return (
    <CrmShell
      activeHref="/crm/settings"
      title="Бизнес-настройки"
      subtitle="Единый центр коммерческих правил АвтоЦена: рынки, этапы, выплаты, CPA, сайт, договоры и история изменений."
    >
      <SettingsSectionNav />

      {!canEdit ? (
        <div className="mb-5 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4 text-sm font-bold leading-6 text-amber-100">
          У вас режим просмотра. Менеджер видит используемые значения, но менять
          глобальные правила могут только owner/admin.
        </div>
      ) : null}

      <BusinessSettingsPanel
        markets={markets}
        siteSettings={siteSettings}
        partnerProgram={partnerProgram}
        cpaNetworks={cpaNetworks}
        contracts={contracts}
        changeLog={changeLog}
        partners={partners}
        canEdit={canEdit}
      />
    </CrmShell>
  );
}
