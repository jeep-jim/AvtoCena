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
  const config = input.marketConfig;
  const configVersion = config.id || `version_${config.version || 0}`;
  const lines: BusinessCalculationLine[] = [];
  const carPriceRub = numberOrZero(input.carPriceRub ?? input.sourcePriceRub);

  addLine(lines, { id: "car", title: "Стоимость автомобиля", amountRub: carPriceRub, kind: "car", amountType: "manual", source: "vehicle" });
  addLine(lines, { id: "security-deposit", title: "Обеспечительный платёж", amountRub: numberOrZero(config.securityDepositRub), kind: "deposit", amountType: "fixed", source: "market_config" });
  addLine(lines, { id: "topavto-commission", title: "Комиссия TopAvto", amountRub: numberOrZero(config.topAvtoCommissionRub), kind: "commission", amountType: "fixed", source: "market_config" });
  addLine(lines, { id: "export", title: "Экспортные расходы", amountRub: numberOrZero(config.exportExpensesRub), kind: "service", amountType: "fixed", source: "market_config" });
  addLine(lines, { id: "logistics", title: "Логистика", amountRub: numberOrZero(config.logisticsRub), kind: "logistics", amountType: "fixed", source: "market_config" });
  addLine(lines, { id: "broker", title: "Брокер", amountRub: numberOrZero(config.brokerRub), kind: "service", amountType: "fixed", source: "market_config" });
  addLine(lines, { id: "svh", title: "СВХ", amountRub: numberOrZero(config.svhRub), kind: "service", amountType: "fixed", source: "market_config" });
  addLine(lines, { id: "laboratory", title: "Лаборатория", amountRub: numberOrZero(config.laboratoryRub), kind: "service", amountType: "fixed", source: "market_config" });
  addLine(lines, { id: "sbkts", title: "СБКТС", amountRub: numberOrZero(config.sbktsRub), kind: "service", amountType: "fixed", source: "market_config" });
  addLine(lines, { id: "epts", title: "ЭПТС", amountRub: numberOrZero(config.eptsRub), kind: "service", amountType: "fixed", source: "market_config" });
  addLine(lines, { id: "rf-delivery", title: input.deliveryCity ? `Доставка по РФ: ${input.deliveryCity}` : "Доставка по РФ", amountRub: numberOrZero(input.cityDeliveryRub ?? config.rfDeliveryRub), kind: "logistics", amountType: "fixed", source: input.cityDeliveryRub ? "manager" : "market_config" });
  addLine(lines, { id: "customs", title: "Таможенные платежи", amountRub: numberOrZero(input.customsRub), kind: "customs", amountType: "calculated", source: "calculated" });
  addLine(lines, { id: "other-fixed", title: "Другие фиксированные расходы", amountRub: numberOrZero(config.otherFixedExpensesRub), kind: "other", amountType: "fixed", source: "market_config" });

  const subtotalBeforePercent = lines.reduce((sum, line) => sum + line.amountRub, 0);
  for (const expense of config.percentExpenses || []) {
    const amountRub = Math.round(subtotalBeforePercent * numberOrZero(expense.percent) / 100);
    addLine(lines, { id: expense.id, title: expense.title, amountRub, kind: "other", amountType: "percent", source: "market_config", note: `${expense.percent}%` });
  }

  const reservePercent = numberOrZero(config.exchangeRateReservePercent);
  if (reservePercent > 0) {
    const amountRub = Math.round(carPriceRub * reservePercent / 100);
    addLine(lines, { id: "exchange-reserve", title: "Резерв на изменение курса", amountRub, kind: "reserve", amountType: "percent", source: "market_config", note: `${reservePercent}% от стоимости авто` });
  }

  const manualAdjustmentRub = Number(input.manualAdjustmentRub || 0);
  if (manualAdjustmentRub !== 0) {
    addLine(lines, { id: "manual-adjustment", title: "Ручная корректировка менеджера", amountRub: manualAdjustmentRub, kind: "adjustment", amountType: "manual", source: "manager", note: input.manualAdjustmentReason || "Причина не указана" });
  }

  const totalRub = lines.reduce((sum, line) => sum + line.amountRub, 0);
  return {
    marketId: input.marketId,
    configVersion,
    effectiveFrom: config.effectiveFrom,
    deliveryCity: input.deliveryCity,
    totalRub,
    breakdown: lines,
    snapshot: {
      configVersion,
      effectiveFrom: config.effectiveFrom,
      marketConfig: JSON.parse(JSON.stringify(config)),
      breakdown: JSON.parse(JSON.stringify(lines)),
    },
  };
}
