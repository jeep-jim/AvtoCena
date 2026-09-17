import type { MarketBusinessConfig } from "../../../../packages/engine/src/types";
import type { MarketId } from "../settings-validation";
import { convertToRub, type CurrencyRateSnapshot } from "./rates";

export const MARKET_LOGISTICS_USD: Record<MarketId, number> = {
  korea: 1_200,
  china: 1_500,
  georgia: 2_500,
  uae: 3_000,
  europe: 4_000,
  japan: 1_000,
};

export type DynamicLogisticsConfig = MarketBusinessConfig & {
  logisticsUsd: number;
  logisticsCurrency: "USD";
  logisticsRateDate?: string;
  logisticsRateSource?: string;
  logisticsUsdRateRub?: number;
  logisticsRateStatus: "ready" | "unavailable";
};

function officialCurrentUsdRate(rate: CurrencyRateSnapshot | null) {
  if (!rate || !["cbr", "cbr_live"].includes(rate.rateSource)) return false;
  const timestamp = Date.parse(rate.rateDate);
  return Number.isFinite(timestamp) && Math.abs(Date.now() - timestamp) <= 4 * 86_400_000;
}

export function applyMarketLogisticsUsdRate(
  marketId: MarketId,
  config: MarketBusinessConfig,
  rate: CurrencyRateSnapshot | null,
): DynamicLogisticsConfig {
  const logisticsUsd = MARKET_LOGISTICS_USD[marketId];
  if (!officialCurrentUsdRate(rate)) {
    return {
      ...config,
      logisticsUsd,
      logisticsCurrency: "USD",
      logisticsRateStatus: "unavailable",
    };
  }
  return {
    ...config,
    logisticsRub: Math.round(logisticsUsd * rate!.effectiveRate),
    logisticsUsd,
    logisticsCurrency: "USD",
    logisticsRateDate: rate!.rateDate,
    logisticsRateSource: rate!.rateSource,
    logisticsUsdRateRub: rate!.effectiveRate,
    logisticsRateStatus: "ready",
  };
}

export async function withCurrentMarketLogisticsUsd(marketId: MarketId, config: MarketBusinessConfig) {
  return applyMarketLogisticsUsdRate(marketId, config, await currentUsdLogisticsRate());
}

export async function currentUsdLogisticsRate() {
  // Logistics is a live USD tariff, not a periodically edited RUB constant.
  // Ask CBR on every server cache cycle; convertToRub deduplicates requests for
  // five minutes and safely falls back to a recent official stored snapshot.
  return convertToRub(1, "USD", { preferLive: true }).catch(() => null);
}
