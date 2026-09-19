import { activeMarketCosts } from "./market-cost-policy";
import type { BusinessCalculationInput, BusinessCalculationLine, BusinessCalculationResult } from "../types";

export type CalculationItem = {
  id: string;
  title: string;
  amountRub: number;
  kind?: "car" | "logistics" | "customs" | "service" | "commission" | "deposit";
};

export function calculateAvtocena(items: CalculationItem[]) {
  const totalRub = items.reduce((sum, item) => sum + item.amountRub, 0);
  const groups = items.reduce<Record<string, number>>((acc, item) => {
    const key = item.kind || "other";
    acc[key] = (acc[key] || 0) + item.amountRub;
    return acc;
  }, {});

  return { items, groups, totalRub };
}

export function rubFromCurrency(amount: number, rate: number) {
  return Math.round(amount * rate);
}

function numberOrZero(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function addLine(lines: BusinessCalculationLine[], line: BusinessCalculationLine) {
  if (line.amountRub > 0 || line.kind === "adjustment") lines.push(line);
}

export function calculateAvtocenaFromBusinessConfig(input: BusinessCalculationInput): BusinessCalculationResult {
  const config = {...activeMarketCosts(input.marketConfig), exchangeRateReservePercent: 0};
  const configVersion = config.id || `version_${config.version || 0}`;
  const lines: BusinessCalculationLine[] = [];
  const originalCarPriceRub = numberOrZero(input.carPriceRub ?? input.sourcePriceRub);
  const automaticAdjustmentRub = Number(input.sourcePriceAdjustmentRub || 0);
  const carPriceRub = Math.max(0, originalCarPriceRub + (Number.isFinite(automaticAdjustmentRub) ? automaticAdjustmentRub : 0));

  // Cost composition is independent of payment timing: always retain the full seller price.
  lines.push({
    id: "car", title: "Цена автомобиля", amountRub: carPriceRub,
    kind: "car", amountType: "manual", source: "vehicle",
  });
  addLine(lines, { id: "topavto-commission", title: "Комиссия Автодилера", amountRub: numberOrZero(config.topAvtoCommissionRub), kind: "commission", amountType: "fixed", source: "market_config" });
  addLine(lines, { id: "logistics", title: "Логистика", amountRub: numberOrZero(config.logisticsRub), kind: "logistics", amountType: "fixed", source: "market_config" });
  addLine(lines, { id: "broker", title: "Брокер", amountRub: numberOrZero(config.brokerRub), kind: "service", amountType: "fixed", source: "market_config" });
  addLine(lines, { id: "svh", title: "СВХ", amountRub: numberOrZero(config.svhRub), kind: "service", amountType: "fixed", source: "market_config" });
  addLine(lines, { id: "laboratory", title: "Лаборатория, СБКТС, ЭПТС",
    includedServices: (Number(config.serviceBundleVersion) >= 1 || [config.laboratoryRub,config.sbktsRub,config.eptsRub].every(value => numberOrZero(value) > 0))
      ? ["laboratory", "sbkts", "epts"] : undefined,
    amountRub: numberOrZero(config.laboratoryRub) + numberOrZero(config.sbktsRub) + numberOrZero(config.eptsRub),
    kind: "service", amountType: "fixed", source: "market_config" });
  addLine(lines, { id: "rf-delivery", title: input.deliveryCity ? `Доставка по РФ: ${input.deliveryCity}` : "Доставка по РФ", amountRub: numberOrZero(input.cityDeliveryRub ?? config.rfDeliveryRub), kind: "logistics", amountType: "fixed", source: input.cityDeliveryRub ? "manager" : "market_config" });
  addLine(lines, {
    id:"customs",title:"Таможенные платежи",amountRub:numberOrZero(input.customsRub),
    kind:"customs",amountType:"calculated",source:"calculated",
    note:"Пошлина, таможенное оформление, акциз и НДС, если применимы",
  });
  addLine(lines, {
    id: "utilization-fee",
    title: "Утилизационный сбор",
    amountRub: numberOrZero(input.utilizationFeeRub),
    kind: "customs",
    amountType: "calculated",
    source: "calculated",
  });
  addLine(lines, { id: "other-fixed", title: "Другие фиксированные расходы", amountRub: numberOrZero(config.otherFixedExpensesRub), kind: "other", amountType: "fixed", source: "market_config" });

  // The Global Che168 correction changes only the customer-facing vehicle
  // price. Percentage expenses keep the same base they had before the
  // source-specific correction; otherwise a 2% price normalization would
  // silently alter unrelated business charges as well.
  const subtotalBeforePercent = lines.reduce((sum, line) => sum + line.amountRub, 0)
    - (Number.isFinite(automaticAdjustmentRub) ? automaticAdjustmentRub : 0);
  for (const expense of config.percentExpenses || []) {
    const amountRub = Math.round(subtotalBeforePercent * numberOrZero(expense.percent) / 100);
    addLine(lines, { id: expense.id, title: expense.title, amountRub, kind: "other", amountType: "percent", source: "market_config", note: `${expense.percent}%` });
  }

  const totalRub = lines.reduce((sum, line) => sum + line.amountRub, 0);
  return {
    marketId: input.marketId,
    configVersion,
    effectiveFrom: config.effectiveFrom,
    deliveryCity: input.deliveryCity,
    totalRub,
    paymentPlan: businessPaymentPlan(input.marketId, config, totalRub),
    breakdown: lines,
    snapshot: {
      paymentPlan: businessPaymentPlan(input.marketId, config, totalRub),
      configVersion,
      effectiveFrom: config.effectiveFrom,
      marketConfig: JSON.parse(JSON.stringify(config)),
      breakdown: JSON.parse(JSON.stringify(lines)),
    },
  };
}

/** Payments allocate an existing total; they must never be summed into its cost lines. */
export function businessPaymentPlan(marketId: string, config: {securityDepositRub?: number | null; topAvtoCommissionRub?: number | null}, totalRub: number) {
  const securityDepositRub = numberOrZero(config.securityDepositRub);
  const commissionRub = numberOrZero(config.topAvtoCommissionRub);
  const contractInitialPaymentRub = securityDepositRub + commissionRub;
  return {
    securityDepositRub, commissionRub, contractInitialPaymentRub,
    depositAppliedTo: marketId === "japan" ? "vehicle" as const : "services" as const,
    remainingAfterInitialRub: Math.max(0, totalRub - contractInitialPaymentRub),
    initialPaymentExceedsTotal: contractInitialPaymentRub > totalRub,
  };
}
