import { CrmShell } from "@/components/crm/CrmShell";
import { BusinessSettingsPanel } from "@/components/crm/settings/BusinessSettingsPanel";
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

export default function CrmSettingsPage() {
  const user = getCurrentUser();
  const canEdit = canEditBusinessSettings(user?.role);

  return (
    <CrmShell
      activeHref="/crm/settings"
      title="Бизнес-настройки"
      subtitle="Единый центр коммерческих правил АвтоЦена: рынки, этапы, выплаты, CPA, сайт, договоры и история изменений."
    >
      <div className="mb-5 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[
          ["#markets", "Рынки"],
          ["#markets", "Расчёт и расходы"],
          ["#markets", "Этапы сделки"],
          ["#partners", "Партнёрские выплаты"],
          ["#cpa", "CPA-сети"],
          ["#site", "Настройки сайта"],
          ["#contracts", "Договоры и шаблоны"],
          ["#history", "История изменений"],
        ].map(([href, label]) => (
          <a key={`${href}-${label}`} href={href} className="shrink-0 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-bold text-white/70">
            {label}
          </a>
        ))}
      </div>

      {!canEdit ? (
        <div className="mb-5 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4 text-sm font-bold leading-6 text-amber-100">
          У вас режим просмотра. Менеджер видит используемые значения, но менять глобальные правила могут только owner/admin.
        </div>
      ) : null}

      <BusinessSettingsPanel
        markets={getMarketsWithEffectiveVersions()}
        siteSettings={getActiveSiteBusinessVersion()}
        partnerProgram={getActiveDirectPartnerPayout()}
        cpaNetworks={getCpaNetworks()}
        contracts={getContractTemplatesSettings()}
        changeLog={getSettingsChangeLog()}
        partners={readDataJson<any[]>("partners/partners.json", [])}
        canEdit={canEdit}
      />
    </CrmShell>
  );
}
