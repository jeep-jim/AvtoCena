import type { BusinessPaymentPlan } from "../../../../packages/engine/src/types";

const rub = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;

export function ContractPaymentSummary({ plan }: { plan?: BusinessPaymentPlan | null }) {
  if (!plan || plan.initialPaymentExceedsTotal) return null;
  return <div data-payment-kind="security-deposit" data-payment-amount-rub={plan.securityDepositRub} className="flex items-baseline justify-between gap-3 text-xs font-medium">
    <span className="min-w-0 text-[var(--ac-muted)]">Обеспечительный платёж</span>
    <span className="shrink-0 whitespace-nowrap font-bold text-[var(--ac-text)]">{rub(plan.securityDepositRub)}</span>
  </div>;
}
