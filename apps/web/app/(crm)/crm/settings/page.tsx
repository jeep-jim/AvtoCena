import { CrmShell } from "@/components/crm/CrmShell";
import { SimpleMarketSettingsPanel } from "@/components/crm/settings/SimpleMarketSettingsPanel";
import { getCurrentUser } from "@/lib/auth";
import { getMarketsWithEffectiveVersions } from "@/lib/business-settings";
import { canEditBusinessSettings } from "@/lib/settings-validation";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value || "";
}

export default async function CrmSettingsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const query: SearchParams = (await searchParams) || {};
  const markets = await getMarketsWithEffectiveVersions();
  const user = getCurrentUser();
  const canEdit = canEditBusinessSettings(user?.role);
  const state = first(query.state);
  const message = first(query.message);

  return (
    <CrmShell activeHref="/crm/settings" title="Рынки и расчёт" subtitle="Только значения, которые участвуют в расчёте цены автомобиля. Договоры, CPA, выплаты и технические настройки убраны из рабочего интерфейса.">
      {state === "saved" ? <div className="mb-4 rounded-2xl bg-emerald-400/12 px-4 py-3 text-sm font-black text-emerald-300">Новая версия расчёта сохранена и применяется к новым расчётам.</div> : null}
      {state === "error" ? <div className="mb-4 rounded-2xl bg-red-500/15 px-4 py-3 text-sm font-black text-red-200">{message || "Не удалось сохранить настройки рынка."}</div> : null}
      <SimpleMarketSettingsPanel markets={markets} canEdit={canEdit} />
    </CrmShell>
  );
}
