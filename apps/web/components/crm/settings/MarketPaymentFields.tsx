"use client";

import { useState } from "react";

const labelClass = "ac-market-setting-label grid gap-1.5 text-xs font-black uppercase tracking-[.08em]";
const inputClass = "soft-input min-w-0 rounded-xl px-3 py-3 text-sm font-black normal-case tracking-normal";

export function MarketPaymentFields({ depositRub, commissionRub }: { depositRub: number; commissionRub: number }) {
  const [deposit, setDeposit] = useState(String(depositRub ?? ""));
  const [commission, setCommission] = useState(String(commissionRub ?? ""));
  const valid = [deposit, commission].every(value => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0);
  const total = Number(deposit) + Number(commission);

  return <>
    <label className={labelClass}>
      Обеспечительный платёж, ₽
      <input name="securityDepositRub" type="number" step="1" min="0" required value={deposit} onChange={event => setDeposit(event.target.value)} className={inputClass} />
    </label>
    <label className={labelClass}>
      Комиссия дилера, ₽
      <input name="topAvtoCommissionRub" type="number" step="1" min="0" required value={commission} onChange={event => setCommission(event.target.value)} className={inputClass} />
    </label>
    <label className={labelClass}>
      Первый платёж по договору, ₽
      <input name="contractInitialPaymentRub" type="number" readOnly value={valid && Number.isFinite(total) ? total : ""} className={inputClass} />
      <span className="text-xs font-normal normal-case tracking-normal">Обеспечительный платёж + комиссия дилера</span>
    </label>
  </>;
}
