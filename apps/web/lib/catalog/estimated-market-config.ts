import type { CatalogMarket } from "./types";

export type EstimatedMarketResolution = {
  config: any;
  estimated: boolean;
  estimatedFields: string[];
  warnings: string[];
};

const DIRECT_COMMISSION_RUB: Record<CatalogMarket, number> = {
  japan: 39_000,
  china: 90_000,
  korea: 90_000,
  uae: 90_000,
  europe: 90_000,
  georgia: 90_000,
  kyrgyzstan: 90_000,
};

const SECURITY_DEPOSIT_RUB: Record<CatalogMarket, number> = {
  japan: 31_000,
  china: 160_000,
  korea: 0,
  uae: 110_000,
  europe: 0,
  georgia: 0,
  kyrgyzstan: 0,
};

const DELIVERY_DAYS: Record<CatalogMarket, string> = {
  japan: "25-45",
  china: "14-30",
  korea: "25-40",
  uae: "30-45",
  europe: "30-60",
  georgia: "20-40",
  kyrgyzstan: "20-40",
};

const CURRENCY: Record<CatalogMarket, string> = {
  japan: "JPY",
  china: "CNY",
  korea: "KRW",
  uae: "AED",
  europe: "EUR",
  georgia: "GEL",
  kyrgyzstan: "KGS",
};

const COMMON_ESTIMATE = {
  brokerRub: 35_000,
  svhRub: 35_000,
  laboratoryRub: 15_000,
  sbktsRub: 35_000,
  eptsRub: 35_000,
  rfDeliveryRub: 120_000,
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
  const estimatedFields: string[] = [];
  const warnings: string[] = [];
  const value = (field: string, fallback: number) => {
    if (present(source[field])) return Number(source[field]);
    estimatedFields.push(field);
    return envAmount(market, field.replace(/Rub$/, ""), fallback);
  };

  const config = {
    ...source,
    id: source.id || `catalog_estimate_${market}_v1`,
    version: Number(source.version || 1),
    status: "active",
    active: true,
    effectiveFrom: source.effectiveFrom || "2026-07-25T00:00:00.000Z",
    currency: source.currency || CURRENCY[market],
    securityDepositRub: value("securityDepositRub", SECURITY_DEPOSIT_RUB[market]),
    topAvtoCommissionRub: value("topAvtoCommissionRub", DIRECT_COMMISSION_RUB[market]),
    exportExpensesRub: value("exportExpensesRub", 0),
    logisticsRub: value("logisticsRub", market === "japan" ? 15_000 : 0),
    brokerRub: value("brokerRub", COMMON_ESTIMATE.brokerRub),
    svhRub: value("svhRub", COMMON_ESTIMATE.svhRub),
    laboratoryRub: value("laboratoryRub", COMMON_ESTIMATE.laboratoryRub),
    sbktsRub: value("sbktsRub", COMMON_ESTIMATE.sbktsRub),
    eptsRub: value("eptsRub", COMMON_ESTIMATE.eptsRub),
    rfDeliveryRub: value("rfDeliveryRub", COMMON_ESTIMATE.rfDeliveryRub),
    otherFixedExpensesRub: value("otherFixedExpensesRub", 0),
    exchangeRateReservePercent: present(source.exchangeRateReservePercent)
      ? Math.max(0, Number(source.exchangeRateReservePercent))
      : 0,
    percentExpenses: Array.isArray(source.percentExpenses) ? source.percentExpenses : [],
    deliveryDays: source.deliveryDays || DELIVERY_DAYS[market],
    conditionsDescription: source.conditionsDescription || "Предварительный расчёт каталога. Финальные расходы и наличие подтверждает менеджер.",
    dealStages: Array.isArray(source.dealStages) ? source.dealStages : [],
  };

  const estimated = !activeConfig(configured) || estimatedFields.length > 0;
  if (!activeConfig(configured)) warnings.push("Коммерческая конфигурация рынка не была активна: применён предварительный профиль каталога.");
  if (estimatedFields.length) warnings.push(`Оценочно заполнены расходы: ${estimatedFields.join(", ")}.`);
  return { config, estimated, estimatedFields, warnings };
}
