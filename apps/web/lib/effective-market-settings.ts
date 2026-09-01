import { getMarketsSettings, selectActiveMarketVersion } from "./business-settings";
import { CATALOG_MARKET_DEFAULTS } from "./catalog/estimated-market-config";
import { MARKET_IDS, type MarketId } from "./settings-validation";

// Production trigger 2026-07-27 17:23 +07 for the catalog market settings.
const MARKET_NAMES: Record<MarketId, string> = {
  japan: "Япония",
  china: "Китай",
  korea: "Корея",
  uae: "ОАЭ",
  europe: "Европа",
  georgia: "Грузия",
};

// A catalog page can price cards from every market. Reading the same remote
// markets.json once per market turned one render into eight signed Object
// Storage requests. Share one immutable snapshot during a browsing session;
// rejected reads are never retained and edits become visible within a minute.
const EFFECTIVE_MARKETS_CACHE_MS = Math.max(1_000, Number(process.env.EFFECTIVE_MARKETS_CACHE_MS || 60_000));
let marketsSettingsCache: { expiresAt: number; promise: ReturnType<typeof getMarketsSettings> } | null = null;

export function invalidateEffectiveMarketsCache() {
  marketsSettingsCache = null;
}

async function getCachedMarketsSettings() {
  const now = Date.now();
  if (marketsSettingsCache && marketsSettingsCache.expiresAt > now) return marketsSettingsCache.promise;
  const promise = getMarketsSettings().catch((error) => {
    marketsSettingsCache = null;
    throw error;
  });
  marketsSettingsCache = { expiresAt: now + EFFECTIVE_MARKETS_CACHE_MS, promise };
  return promise;
}

function present(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function configuredValue(current: any, field: string, fallback: number) {
  return present(current?.[field]) ? Number(current[field]) : fallback;
}

function defaultInitialPayment(marketId: MarketId, deposit: number, commission: number) {
  if (marketId === "japan") return 70_000;
  if (marketId === "china") return 250_000;
  return Math.max(200_000, deposit + commission);
}

function hasCompleteActiveProfile(current: any) {
  if (!current || current.status !== "active" || current.active === false) return false;
  return [
    "securityDepositRub", "topAvtoCommissionRub", "exportExpensesRub", "logisticsRub",
    "brokerRub", "svhRub", "laboratoryRub", "sbktsRub", "eptsRub", "rfDeliveryRub",
    "otherFixedExpensesRub", "exchangeRateReservePercent",
  ].every((field) => present(current[field]));
}

export function resolveEffectiveMarketVersion(marketId: MarketId, current: any) {
  const defaults = CATALOG_MARKET_DEFAULTS[marketId];
  const deposit = configuredValue(current, "securityDepositRub", defaults.securityDepositRub);
  const commission = configuredValue(current, "topAvtoCommissionRub", defaults.topAvtoCommissionRub);
  const complete = hasCompleteActiveProfile(current);
  const provisional = current?.provisional === false ? false : !complete || Boolean(current?.provisional);

  return {
    ...(current || {}),
    id: complete ? current.id : `market_${marketId}_system_average_v2`,
    version: complete ? Number(current.version || 1) : Math.max(2, Number(current?.version || 0) + 1),
    status: "active",
    active: true,
    effectiveFrom: current?.effectiveFrom || "2026-07-27T00:00:00.000Z",
    currency: current?.currency || defaults.currency,
    securityDepositRub: deposit,
    topAvtoCommissionRub: commission,
    contractInitialPaymentRub: present(current?.contractInitialPaymentRub)
      ? Math.max(Number(current.contractInitialPaymentRub), deposit + commission)
      : defaultInitialPayment(marketId, deposit, commission),
    exchangeRateReservePercent: configuredValue(current, "exchangeRateReservePercent", defaults.exchangeRateReservePercent),
    exportExpensesRub: configuredValue(current, "exportExpensesRub", defaults.exportExpensesRub),
    logisticsRub: configuredValue(current, "logisticsRub", defaults.logisticsRub),
    brokerRub: configuredValue(current, "brokerRub", defaults.brokerRub),
    svhRub: configuredValue(current, "svhRub", defaults.svhRub),
    laboratoryRub: configuredValue(current, "laboratoryRub", defaults.laboratoryRub),
    sbktsRub: configuredValue(current, "sbktsRub", defaults.sbktsRub),
    eptsRub: configuredValue(current, "eptsRub", defaults.eptsRub),
    rfDeliveryRub: configuredValue(current, "rfDeliveryRub", defaults.rfDeliveryRub),
    otherFixedExpensesRub: configuredValue(current, "otherFixedExpensesRub", defaults.otherFixedExpensesRub),
    percentExpenses: Array.isArray(current?.percentExpenses) ? current.percentExpenses : [],
    minMax: current?.minMax && typeof current.minMax === "object" ? current.minMax : {},
    deliveryDays: current?.deliveryDays || defaults.deliveryDays,
    conditionsDescription: current?.conditionsDescription || "Предварительные средние расходы для автоматического расчёта. Финальные условия подтверждает менеджер.",
    dealStages: Array.isArray(current?.dealStages) ? current.dealStages : [],
    provisional,
    defaultsSource: current?.defaultsSource || (provisional ? "system_average_2026-07-27" : undefined),
  };
}

export async function getEffectiveMarketVersion(marketId: string) {
  if (!MARKET_IDS.includes(marketId as MarketId)) return null;
  const raw = await getCachedMarketsSettings();
  const market = raw.find((item) => item.id === marketId);
  const current = selectActiveMarketVersion(market);
  return resolveEffectiveMarketVersion(marketId as MarketId, current);
}

export async function getEffectiveMarketsWithDefaults() {
  const raw = await getCachedMarketsSettings();
  const byId = new Map(raw.map((market) => [market.id, market]));
  return MARKET_IDS.map((marketId) => {
    const market = byId.get(marketId) || { id: marketId, name: MARKET_NAMES[marketId], versions: [] };
    const current = selectActiveMarketVersion(market);
    const effectiveVersion = resolveEffectiveMarketVersion(marketId, current);
    return {
      ...market,
      id: marketId,
      name: market.name || MARKET_NAMES[marketId],
      activeVersionId: effectiveVersion.id,
      effectiveVersion,
    };
  });
}
