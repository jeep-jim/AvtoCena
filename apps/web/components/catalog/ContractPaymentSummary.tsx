import type { BusinessPaymentPlan } from "../../../../packages/engine/src/types";

const rub = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;

export function ContractPaymentSummary({ plan }: { plan?: BusinessPaymentPlan | null }) {
  if (!plan || plan.initialPaymentExceedsTotal) return null;
  return <section className="mt-3 border-t border-dotted border-[var(--ac-border)] px-4 py-3 text-xs" aria-label="Порядок оплаты">
    <h3 className="font-bold">Порядок оплаты</h3>
    <p className="mt-2">При заключении договора: <strong>{rub(plan.contractInitialPaymentRub)}</strong></p>
    <p className="mt-1 text-[var(--ac-muted)]">Обеспечительный платёж {rub(plan.securityDepositRub)} + комиссия {rub(plan.commissionRub)}. Эти суммы уже входят в итоговую стоимость.</p>
    <p className="mt-1 text-[var(--ac-muted)]">Обеспечительный платёж засчитывается {plan.depositAppliedTo === "vehicle" ? "в оплату автомобиля" : "в оплату услуг"}.</p>
    <p className="mt-2">После первого платежа останется: <strong>{rub(plan.remainingAfterInitialRub)}</strong></p>
  </section>;
}
