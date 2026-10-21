import type { BusinessPaymentPlan } from "../../../../packages/engine/src/types";

const rub = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;

export function ContractPaymentSummary({ plan, embedded = false }: { plan?: BusinessPaymentPlan | null; embedded?: boolean }) {
  if (!plan || plan.initialPaymentExceedsTotal) return null;
  if (embedded) return <div data-payment-kind="security-deposit" data-payment-amount-rub={plan.securityDepositRub} className="mt-2 flex justify-between gap-3 text-xs"><dt>Обеспечительный платёж</dt><dd className="shrink-0 whitespace-nowrap">{rub(plan.securityDepositRub)}</dd></div>;
  return <div data-payment-kind="security-deposit" data-payment-amount-rub={plan.securityDepositRub} className="ac-cost-row px-4">
    <span className="ac-cost-label">Обеспечительный платёж</span>
    <span className="ac-cost-amount">{rub(plan.securityDepositRub)}</span>
  </div>;
}
