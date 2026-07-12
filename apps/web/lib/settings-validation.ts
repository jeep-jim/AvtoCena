export const MARKET_IDS = ["japan", "china", "korea", "uae", "europe"] as const;
export const AMOUNT_TYPES = ["fixed", "percent", "calculated", "manual"] as const;
export const PAYOUT_TYPES = ["fixed", "percent", "tiered", "custom/manual"] as const;

export type MarketId = (typeof MARKET_IDS)[number];
export type AmountType = (typeof AMOUNT_TYPES)[number];

export function cleanText(value: unknown, maxLength = 2000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/\s/g, ""));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function booleanFromForm(value: unknown) {
  return value === true || value === "true" || value === "on" || value === "1";
}

export function isMarketId(value: unknown): value is MarketId {
  return typeof value === "string" && MARKET_IDS.includes(value as MarketId);
}

export function validateDealStage(stage: any) {
  const amountType = AMOUNT_TYPES.includes(stage?.amountType) ? stage.amountType : "manual";
  return {
    order: Math.max(1, Number(stage?.order || 1)),
    title: cleanText(stage?.title, 160),
    description: cleanText(stage?.description, 1000),
    trigger: cleanText(stage?.trigger, 120),
    amount: nullableNumber(stage?.amount),
    amountType,
    payer: cleanText(stage?.payer, 120),
    recipient: cleanText(stage?.recipient, 160),
    includedInTotal: Boolean(stage?.includedInTotal),
    refundable: Boolean(stage?.refundable),
    required: Boolean(stage?.required),
    paymentDue: cleanText(stage?.paymentDue, 200),
    active: stage?.active !== false,
  };
}

export function validateMarketVersion(version: any) {
  const name = cleanText(version?.name, 120);
  const currency = cleanText(version?.currency, 12).toUpperCase();
  const deliveryDays = cleanText(version?.deliveryDays, 80);
  const dealStages = Array.isArray(version?.dealStages)
    ? version.dealStages.map(validateDealStage).filter((stage: any) => stage.title)
    : [];

  const errors: string[] = [];
  if (!currency) errors.push("currency_required");
  if (version?.status === "active") {
    if (nullableNumber(version?.securityDepositRub) === null) errors.push("security_deposit_required_for_active");
    if (nullableNumber(version?.topAvtoCommissionRub) === null) errors.push("commission_required_for_active");
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      ...version,
      name,
      currency,
      active: Boolean(version?.active),
      topAvtoCommissionRub: nullableNumber(version?.topAvtoCommissionRub),
      securityDepositRub: nullableNumber(version?.securityDepositRub),
      contractInitialPaymentRub: nullableNumber(version?.contractInitialPaymentRub),
      exchangeRateReservePercent: nullableNumber(version?.exchangeRateReservePercent) ?? 0,
      exportExpensesRub: nullableNumber(version?.exportExpensesRub),
      logisticsRub: nullableNumber(version?.logisticsRub),
      brokerRub: nullableNumber(version?.brokerRub),
      svhRub: nullableNumber(version?.svhRub),
      laboratoryRub: nullableNumber(version?.laboratoryRub),
      sbktsRub: nullableNumber(version?.sbktsRub),
      eptsRub: nullableNumber(version?.eptsRub),
      rfDeliveryRub: nullableNumber(version?.rfDeliveryRub),
      otherFixedExpensesRub: nullableNumber(version?.otherFixedExpensesRub),
      percentExpenses: Array.isArray(version?.percentExpenses) ? version.percentExpenses : [],
      minMax: typeof version?.minMax === "object" && version?.minMax ? version.minMax : {},
      deliveryDays,
      conditionsDescription: cleanText(version?.conditionsDescription, 3000),
      dealStages,
    },
  };
}

export function canEditBusinessSettings(role?: string | null) {
  return role === "owner" || role === "admin";
}
