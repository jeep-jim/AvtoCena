import { CatalogMarketFlag } from "@/components/catalog/CatalogMarketFlag";
import { money } from "@/lib/avtocena";

const paymentFields = [
  ["securityDepositRub", "Обеспечительный платёж, ₽"],
  ["contractInitialPaymentRub", "Первоначальный платёж по договору, ₽"],
] as const;

const calculationFields = [
  ["exchangeRateReservePercent", "Резерв курса, %"],
  ["topAvtoCommissionRub", "Комиссия компании, ₽"],
  ["exportExpensesRub", "Расходы в стране покупки, ₽"],
  ["logisticsRub", "Международная логистика, ₽"],
  ["brokerRub", "Брокер, ₽"],
  ["svhRub", "СВХ, ₽"],
  ["laboratoryRub", "Лаборатория, ₽"],
  ["sbktsRub", "СБКТС, ₽"],
  ["eptsRub", "ЭПТС, ₽"],
  ["rfDeliveryRub", "Доставка по России, ₽"],
  ["otherFixedExpensesRub", "Другие расходы, ₽"],
] as const;

const fieldLabelClass = "ac-market-setting-label grid gap-1.5 text-xs font-black uppercase tracking-[.08em]";

function numberValue(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : "";
}

function hiddenJson(name: string, value: unknown) {
  return <input type="hidden" name={name} value={JSON.stringify(value ?? (name === "dealStages" || name === "percentExpenses" ? [] : {}))} />;
}

function ChevronDown() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5.5 7.75L10 12.25L14.5 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SimpleMarketSettingsPanel({ markets, canEdit }: { markets: any[]; canEdit: boolean }) {
  return (
    <div className="space-y-4">
      <section className="glass rounded-[1.8rem] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black">Все рынки</h2>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-white/48">
              Здесь находятся цифры, которые используются в цене автомобиля. Сохранённая версия сразу применяется к карточкам и каталогу; полный поисковый индекс обновляется фоновым пересчётом.
            </p>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/60">{markets.length} рынков</span>
        </div>
      </section>

      {markets.map((market) => {
        const version = market.effectiveVersion || market.versions?.find((item: any) => item.id === market.activeVersionId) || market.versions?.[0] || {};
        const fixedTotal = calculationFields
          .filter(([name]) => name !== "exchangeRateReservePercent")
          .reduce((sum, [name]) => sum + (Number(version[name]) || 0), 0);
        const provisional = Boolean(version.provisional);

        return (
          <details key={market.id} className="group glass rounded-[1.8rem]" open={market.id === "japan"}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <CatalogMarketFlag market={market.id} className="h-5 w-7 shrink-0" />
                  <h2 className="text-2xl font-black">{market.name}</h2>
                  <span className="rounded-full bg-emerald-400/12 px-2.5 py-1 text-[11px] font-black text-emerald-300">активна · версия {version.version || 1}</span>
                  {provisional ? <span className="rounded-full bg-amber-400/12 px-2.5 py-1 text-[11px] font-black text-amber-200">средние значения</span> : null}
                </div>
                <div className="mt-2 text-sm font-bold text-white/45">
                  Валюта {version.currency || "—"} · расходы {money(fixedTotal)} ₽ · первый платёж {money(Number(version.contractInitialPaymentRub) || 0)} ₽ · резерв курса {numberValue(version.exchangeRateReservePercent) || 0}%
                </div>
              </div>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[.07] text-white/65 transition group-open:rotate-180">
                <ChevronDown />
              </span>
            </summary>

            <div className="border-t border-white/8 p-5 pt-4">
              {provisional ? <div className="mb-4 rounded-2xl bg-amber-400/10 px-4 py-3 text-sm font-bold leading-6 text-amber-100">Сейчас используются безопасные средние значения. Уточните любой расход и сохраните — новая версия сразу станет активной на сайте.</div> : null}
              {!canEdit ? (
                <div className="rounded-2xl bg-amber-400/10 px-4 py-3 text-sm font-bold text-amber-100">Просмотр без права изменения.</div>
              ) : (
                <form action="/api/crm/settings/markets" method="post" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <input type="hidden" name="marketId" value={market.id} />
                  <input type="hidden" name="name" value={market.name} />
                  <input type="hidden" name="deliveryDays" value={version.deliveryDays || ""} />
                  <input type="hidden" name="conditionsDescription" value={version.conditionsDescription || ""} />
                  <input type="hidden" name="provisional" value={provisional ? "true" : "false"} />
                  {hiddenJson("percentExpenses", version.percentExpenses)}
                  {hiddenJson("minMax", version.minMax)}
                  {hiddenJson("dealStages", version.dealStages)}

                  <label className={fieldLabelClass}>
                    Валюта
                    <input name="currency" defaultValue={version.currency || ""} className="soft-input rounded-xl px-3 py-3 text-sm font-black normal-case tracking-normal" />
                  </label>

                  {paymentFields.map(([name, label]) => (
                    <label key={name} className={fieldLabelClass}>
                      {label}
                      <input name={name} type="number" step="1" min="0" defaultValue={numberValue(version[name])} className="soft-input rounded-xl px-3 py-3 text-sm font-black normal-case tracking-normal" />
                    </label>
                  ))}

                  {calculationFields.map(([name, label]) => (
                    <label key={name} className={fieldLabelClass}>
                      {label}
                      <input name={name} type="number" step={name === "exchangeRateReservePercent" ? "0.01" : "1"} min="0" defaultValue={numberValue(version[name])} className="soft-input rounded-xl px-3 py-3 text-sm font-black normal-case tracking-normal" />
                    </label>
                  ))}

                  <label className={`${fieldLabelClass} md:col-span-2 xl:col-span-3`}>
                    Комментарий к изменению
                    <input name="comment" placeholder="Например: обновили логистику с 1 августа" className="soft-input rounded-xl px-3 py-3 text-sm font-black normal-case tracking-normal" />
                  </label>

                  <label className="flex items-center gap-3 rounded-xl bg-white/[.045] px-4 py-3 text-sm font-bold text-white/68">
                    <input type="checkbox" name="active" defaultChecked={version.active !== false} />
                    Сразу применить к расчётам сайта
                  </label>

                  <button className="rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black text-white md:col-span-2 xl:col-span-2">
                    Сохранить и применить новую версию
                  </button>
                </form>
              )}
            </div>
          </details>
        );
      })}
      <style dangerouslySetInnerHTML={{ __html: `
        html:not([data-theme="light"]) .ac-market-setting-label{color:rgba(255,255,255,.46)!important}
        html[data-theme="light"] .ac-market-setting-label{color:rgba(30,36,48,.58)!important}
      ` }} />
    </div>
  );
}
