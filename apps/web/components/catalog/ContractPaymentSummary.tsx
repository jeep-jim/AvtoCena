import type { BusinessPaymentPlan } from "../../../../packages/engine/src/types";

const rub = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;

export function ContractPaymentSummary({ plan, embedded = false }: { plan?: BusinessPaymentPlan | null; embedded?: boolean }) {
  if (!plan || plan.initialPaymentExceedsTotal) return null;
  if (embedded) return <div data-payment-kind="security-deposit" data-payment-amount-rub={plan.securityDepositRub} className="mt-2 flex justify-between gap-3 text-xs"><dt>Обеспечительный платёж</dt><dd className="shrink-0 whitespace-nowrap">{rub(plan.securityDepositRub)}</dd></div>;
  return <div data-payment-kind="security-deposit" data-payment-amount-rub={plan.securityDepositRub} className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 py-1.5 text-[12px] font-medium md:text-[13px] ${embedded ? "" : "px-4"}`}>
    <span className="flex min-w-0 items-baseline gap-2 text-[var(--ac-muted)]">
      <span className="min-w-0 leading-snug">Обеспечительный платёж</span>
      <span className="mb-1 min-w-3 flex-1 border-b border-dotted border-[var(--ac-border)]" />
    </span>
    <span className="whitespace-nowrap font-bold text-[var(--ac-text)]">{rub(plan.securityDepositRub)}</span>
  </div>;
}
