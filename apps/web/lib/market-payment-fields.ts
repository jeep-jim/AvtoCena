import { nullableNumber } from "./settings-validation";

// The two editable amounts are authoritative. Older, already-open forms only
// submit the total and commission; keep those submissions compatible.
export function marketPaymentFields(form: FormData, marketId: string) {
  const topAvtoCommissionRub = nullableNumber(form.get("topAvtoCommissionRub"));
  if (topAvtoCommissionRub === null) throw new Error("Укажите корректную комиссию дилера");

  let securityDepositRub: number;
  if (form.has("securityDepositRub")) {
    const enteredDeposit = nullableNumber(form.get("securityDepositRub"));
    if (enteredDeposit === null) throw new Error("Укажите корректный обеспечительный платёж");
    securityDepositRub = enteredDeposit;
  } else {
    const enteredTotal = nullableNumber(form.get("contractInitialPaymentRub"));
    if (form.has("contractInitialPaymentRub") && enteredTotal === null) {
      throw new Error("Укажите корректный первый платёж");
    }
    const total = enteredTotal ?? (marketId === "japan" ? 70_000 : 250_000);
    if (total < topAvtoCommissionRub) throw new Error("Первый платёж не может быть меньше комиссии");
    securityDepositRub = total - topAvtoCommissionRub;
  }

  const contractInitialPaymentRub = securityDepositRub + topAvtoCommissionRub;
  if (!Number.isFinite(contractInitialPaymentRub)) throw new Error("Слишком большая сумма первого платежа");
  return { securityDepositRub, topAvtoCommissionRub, contractInitialPaymentRub };
}
