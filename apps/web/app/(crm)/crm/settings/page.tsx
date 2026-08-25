import { CrmShell } from "@/components/crm/CrmShell";
import { CalculationEnginePreview } from "@/components/crm/settings/CalculationEnginePreview";
import { SimpleMarketSettingsPanel } from "@/components/crm/settings/SimpleMarketSettingsPanel";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveMarketsWithDefaults } from "@/lib/effective-market-settings";
import { canEditBusinessSettings } from "@/lib/settings-validation";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value || "";
}

export default async function CrmSettingsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const query: SearchParams = (await searchParams) || {};
  const markets = await getEffectiveMarketsWithDefaults();
  const user = getCurrentUser();
  const canEdit = canEditBusinessSettings(user?.role);
  const state = first(query.state);
  const message = first(query.message);

  return (
    <CrmShell activeHref="/crm/settings" title="Рынки и расчёт" subtitle="Коммерческие расходы семи рынков, которые сразу участвуют в цене автомобиля. Таможня и утильсбор рассчитываются ядром отдельно по характеристикам конкретной машины.">
      {state === "saved" ? <div className="mb-4 rounded-2xl bg-emerald-400/12 px-4 py-3 text-sm font-black text-emerald-300">Новая версия сохранена. Карточки используют её сразу; фоновый пересчёт обновит весь поисковый индекс.</div> : null}
      {state === "error" ? <div className="mb-4 rounded-2xl bg-red-500/15 px-4 py-3 text-sm font-black text-red-200">{message || "Не удалось сохранить настройки рынка."}</div> : null}
      <CalculationEnginePreview markets={markets} query={query} />
      <SimpleMarketSettingsPanel markets={markets} canEdit={canEdit} />
    </CrmShell>
  );
}
