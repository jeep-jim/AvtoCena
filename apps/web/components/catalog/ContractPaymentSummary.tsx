import type { BusinessPaymentPlan } from "../../../../packages/engine/src/types";

const rub = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;

export function ContractPaymentSummary({ plan }: { plan?: BusinessPaymentPlan | null }) {
  if (!plan || plan.initialPaymentExceedsTotal) return null;
  return <details className="mx-4 my-2 rounded-lg border border-[var(--ac-border)] px-3 py-2 text-xs">
      <summary className="flex min-h-8 cursor-pointer items-center justify-between gap-3 font-semibold" aria-label="Что включает обеспечительный платёж">
        <span>Обеспечительный платёж {rub(plan.securityDepositRub)}</span>
        <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ac-surface-3)]">?</span>
      </summary>
      <p className="mt-2 leading-relaxed text-[var(--ac-muted)]">{plan.depositAppliedTo === "vehicle"
        ? "Аванс для участия в аукционе. После покупки полностью засчитывается в оплату автомобиля и не увеличивает его стоимость."
        : "Предоплата услуг в стране покупки: поиск, проверка и осмотр автомобиля, подготовка экспортных документов и отчёта о его состоянии, а также комиссия экспортной компании. Входит в итоговую стоимость и повторно не начисляется."}</p>
    </details>;
}
