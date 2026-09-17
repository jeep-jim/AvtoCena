import type { BusinessPaymentPlan } from "../../../../packages/engine/src/types";

const rub = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;

export function ContractPaymentSummary({ plan }: { plan?: BusinessPaymentPlan | null }) {
  if (!plan || plan.initialPaymentExceedsTotal) return null;
  return <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 px-4 py-1.5 text-[12px] font-medium md:text-[13px]">
    <span className="flex min-w-0 items-baseline gap-2 text-[var(--ac-muted)]">
      <span className="min-w-0 leading-snug">Обеспечительный платёж</span>
      <span className="mb-1 min-w-3 flex-1 border-b border-dotted border-[var(--ac-border)]" />
    </span>
    <span className="whitespace-nowrap font-bold text-[var(--ac-text)]">{rub(plan.securityDepositRub)}</span>
  </div>;
}
