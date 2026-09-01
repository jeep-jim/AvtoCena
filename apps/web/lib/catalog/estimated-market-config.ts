import type { CatalogMarket } from "./types";

export type EstimatedMarketResolution = {
  config: any;
  estimated: boolean;
  estimatedFields: string[];
  warnings: string[];
};

type MarketDefaults = {
  currency: string;
  securityDepositRub: number;
  topAvtoCommissionRub: number;
  exportExpensesRub: number;
  logisticsRub: number;
  brokerRub: number;
  svhRub: number;
  laboratoryRub: number;
  sbktsRub: number;
  eptsRub: number;
  rfDeliveryRub: number;
  otherFixedExpensesRub: number;
  exchangeRateReservePercent: number;
  deliveryDays: string;
};

export const CATALOG_MARKET_DEFAULTS: Record<CatalogMarket, MarketDefaults> = {
  japan: { currency: "JPY", securityDepositRub: 31_000, topAvtoCommissionRub: 39_000, exportExpensesRub: 100_000, logisticsRub: 250_000, brokerRub: 35_000, svhRub: 35_000, laboratoryRub: 15_000, sbktsRub: 35_000, eptsRub: 35_000, rfDeliveryRub: 120_000, otherFixedExpensesRub: 0, exchangeRateReservePercent: 2, deliveryDays: "25-45" },
  china: { currency: "CNY", securityDepositRub: 160_000, topAvtoCommissionRub: 90_000, exportExpensesRub: 80_000, logisticsRub: 250_000, brokerRub: 35_000, svhRub: 35_000, laboratoryRub: 15_000, sbktsRub: 35_000, eptsRub: 35_000, rfDeliveryRub: 120_000, otherFixedExpensesRub: 0, exchangeRateReservePercent: 2, deliveryDays: "14-30" },
  korea: { currency: "KRW", securityDepositRub: 110_000, topAvtoCommissionRub: 90_000, exportExpensesRub: 70_000, logisticsRub: 250_000, brokerRub: 35_000, svhRub: 35_000, laboratoryRub: 15_000, sbktsRub: 35_000, eptsRub: 35_000, rfDeliveryRub: 120_000, otherFixedExpensesRub: 0, exchangeRateReservePercent: 2, deliveryDays: "25-40" },
  uae: { currency: "AED", securityDepositRub: 110_000, topAvtoCommissionRub: 90_000, exportExpensesRub: 120_000, logisticsRub: 450_000, brokerRub: 35_000, svhRub: 35_000, laboratoryRub: 15_000, sbktsRub: 35_000, eptsRub: 35_000, rfDeliveryRub: 120_000, otherFixedExpensesRub: 0, exchangeRateReservePercent: 2, deliveryDays: "30-45" },
  europe: { currency: "EUR", securityDepositRub: 110_000, topAvtoCommissionRub: 90_000, exportExpensesRub: 100_000, logisticsRub: 350_000, brokerRub: 35_000, svhRub: 35_000, laboratoryRub: 15_000, sbktsRub: 35_000, eptsRub: 35_000, rfDeliveryRub: 120_000, otherFixedExpensesRub: 0, exchangeRateReservePercent: 2, deliveryDays: "30-60" },
  georgia: { currency: "GEL", securityDepositRub: 110_000, topAvtoCommissionRub: 90_000, exportExpensesRub: 50_000, logisticsRub: 180_000, brokerRub: 35_000, svhRub: 35_000, laboratoryRub: 15_000, sbktsRub: 35_000, eptsRub: 35_000, rfDeliveryRub: 120_000, otherFixedExpensesRub: 0, exchangeRateReservePercent: 2, deliveryDays: "20-40" },
};

function envAmount(market: CatalogMarket, field: string, fallback: number) {
  const key = `CATALOG_ESTIMATE_${market.toUpperCase()}_${field.toUpperCase()}_RUB`;
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function present(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function activeConfig(config: any) {
  return Boolean(config && config.status === "active" && config.active !== false);
}

export function resolveCatalogMarketConfig(market: CatalogMarket, configured: any): EstimatedMarketResolution {
  const source = configured && typeof configured === "object" ? configured : {};
  const defaults = CATALOG_MARKET_DEFAULTS[market];
  const estimatedFields: string[] = [];
  const warnings: string[] = [];
  const value = (field: keyof MarketDefaults) => {
    if (present(source[field])) return Number(source[field]);
    estimatedFields.push(String(field));
    return envAmount(market, String(field).replace(/Rub$/, ""), Number(defaults[field]));
  };

  const config = {
    ...source,
    id: source.id || `catalog_estimate_${market}_v2`,
    version: Number(source.version || 2),
    status: "active",
    active: true,
    effectiveFrom: source.effectiveFrom || "2026-07-27T00:00:00.000Z",
    currency: source.currency || defaults.currency,
    securityDepositRub: value("securityDepositRub"),
    topAvtoCommissionRub: value("topAvtoCommissionRub"),
    exportExpensesRub: value("exportExpensesRub"),
    logisticsRub: value("logisticsRub"),
    brokerRub: value("brokerRub"),
    svhRub: value("svhRub"),
    laboratoryRub: value("laboratoryRub"),
    sbktsRub: value("sbktsRub"),
    eptsRub: value("eptsRub"),
    rfDeliveryRub: value("rfDeliveryRub"),
    otherFixedExpensesRub: value("otherFixedExpensesRub"),
    exchangeRateReservePercent: present(source.exchangeRateReservePercent)
      ? Math.max(0, Number(source.exchangeRateReservePercent))
      : defaults.exchangeRateReservePercent,
    percentExpenses: Array.isArray(source.percentExpenses) ? source.percentExpenses : [],
    deliveryDays: source.deliveryDays || defaults.deliveryDays,
    conditionsDescription: source.conditionsDescription || "Предварительные средние расходы. Финальные коммерческие условия подтверждает менеджер.",
    dealStages: Array.isArray(source.dealStages) ? source.dealStages : [],
    provisional: source.provisional !== false,
  };

  const provisional = Boolean(config.provisional);
  const estimated = provisional || !activeConfig(configured) || estimatedFields.length > 0;
  if (!activeConfig(configured)) warnings.push("Коммерческая конфигурация рынка не была активна: применён предварительный средний профиль.");
  if (provisional) warnings.push("Используются предварительные средние расходы рынка; владелец может уточнить их в CRM.");
  if (estimatedFields.length) warnings.push(`Оценочно заполнены расходы: ${estimatedFields.join(", ")}.`);
  return { config, estimated, estimatedFields, warnings };
}
