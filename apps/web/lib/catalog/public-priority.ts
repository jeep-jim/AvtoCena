import type { VehicleOffer } from "./types";

export type CatalogPublicPriority = {
  eligible: boolean;
  tier: number;
  reason: string;
  visibleRub: number;
  ageYears: number;
  powerHp: number;
  popularityDecile: number;
  calculated: boolean;
  preliminary: boolean;
  imageCount: number;
  japanAuction: boolean;
};

export type CatalogPriceOutlier = {
  id: string;
  market: string;
  make: string;
  model: string;
  year: number;
  totalRub: number;
  peerMedianRub: number;
  peerCount: number;
  ratioToMedian: number;
  direction: "below" | "above";
};

const REQUIRED_PRICE_LINES = [
  "car",
  "topavto-commission",
  "broker",
  "svh",
  "laboratory",
  "sbkts",
  "epts",
  "rf-delivery",
  "customs",
];

const PRELIMINARY_POWER_MISSING = new Set([
  "certified_30_minute_power_kw",
  "utilization_power_kw",
  "utilization_coefficient",
  "ice_power_kw",
  "electric_excise_power_kw",
  "power_hp",
]);

function positive(value: unknown, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= max ? number : 0;
}

function completeCalculation(offer: Partial<VehicleOffer> | any) {
  const totalRub = positive(offer?.totalRub, 1_000_000_000);
  const status = String(offer?.calculationStatus || "");
  const customs = offer?.calculationSnapshot?.customs;
  const breakdown = Array.isArray(offer?.calculationSnapshot?.breakdown)
    ? offer.calculationSnapshot.breakdown
    : [];
  const positiveIds = new Set(breakdown
    .filter((line: any) => positive(line?.amountRub, 1_000_000_000) > 0)
    .map((line: any) => String(line?.id || "")));
  return Boolean(
    totalRub
      && ["ready", "estimated", "auction_start", "calculated"].includes(status)
      && customs?.status === "ready"
      && REQUIRED_PRICE_LINES.every((id) => positiveIds.has(id)),
  );
}

function preliminaryPowerPendingCalculation(offer: Partial<VehicleOffer> | any) {
  const totalRub = positive(offer?.totalRub, 1_000_000_000);
  const kind = String(offer?.powertrainKind || "");
  const snapshot = offer?.calculationSnapshot || {};
  const customs = snapshot.customs || {};
  const missing = (Array.isArray(snapshot.missing) ? snapshot.missing : customs.missing || []).map(String).filter(Boolean);
  const breakdown = Array.isArray(snapshot.breakdown) ? snapshot.breakdown : [];
  const hasCar = breakdown.some((line: any) => String(line?.id || "") === "car" && positive(line?.amountRub) > 0);
  const hasKnownCustoms = breakdown.some((line: any) => String(line?.id || "") === "customs" && positive(line?.amountRub) > 0);
  return Boolean(totalRub
    && ["combustion", "electric", "series_hybrid", "other_hybrid"].includes(kind)
    && String(offer?.calculationStatus || "") === "preliminary_power_pending"
    && snapshot.pricingConfidence === "preliminary"
    && snapshot.priceIncludesUtilizationFee === false
    && customs.status === "needs_data"
    && missing.length > 0
    && missing.every((item: string) => PRELIMINARY_POWER_MISSING.has(item))
    && hasCar && hasKnownCustoms);
}

function regionalPhotoIdentityVerified(offer: Partial<VehicleOffer> | any) {
  const market = String(offer?.market || "").toLowerCase();
  if (!["georgia", "kyrgyzstan"].includes(market)) return true;
  const raw = offer?.operational?.raw || {};
  return raw?.listingBoundImages === true
    || raw?.photoIdentityVerified === true
    || raw?.detailIdentityVerified === true;
}

export function isJapanAuctionOffer(offer: Partial<VehicleOffer> | any) {
  if (String(offer?.market || "").toLowerCase() !== "japan") return false;
  const source = String(offer?.sourceId || "").toLowerCase();
  const priceMode = String(offer?.priceMode || "").toLowerCase();
  const raw = offer?.operational?.raw || {};
  return priceMode === "auction_start"
    || Boolean(raw?.auctionResult || raw?.isAuctionResult || raw?.auctionStatistics)
    || /auction|auc_|_stat|statistics|jpauc|carvector/.test(source);
}

function publicPriceLimits() {
  // 8M is a sorting preference, not a visibility gate. A correctly calculated
  // car must show the same RUB total on the list card and on the detail page.
  const preferredMaximumRub = Math.max(1_000_000, Number(process.env.CATALOG_PUBLIC_MAX_TOTAL_RUB || 8_000_000));
  const absoluteMaximumRub = Math.max(preferredMaximumRub, Number(process.env.CATALOG_PUBLIC_ABSOLUTE_MAX_TOTAL_RUB || 100_000_000));
  return { preferredMaximumRub, absoluteMaximumRub };
}

export function catalogOfferVisibleRub(offer: Partial<VehicleOffer> | any) {
  const projectedVisibleRub = Math.round(positive(offer?.publicVisibleRub, 1_000_000_000));
  if (projectedVisibleRub) {
    const { absoluteMaximumRub } = publicPriceLimits();
    return projectedVisibleRub <= absoluteMaximumRub ? projectedVisibleRub : 0;
  }
  if (!completeCalculation(offer) && !preliminaryPowerPendingCalculation(offer)) return 0;
  const totalRub = Math.round(positive(offer?.totalRub, 1_000_000_000));
  if (!totalRub) return 0;
  const { absoluteMaximumRub } = publicPriceLimits();
  return totalRub <= absoluteMaximumRub ? totalRub : 0;
}

function knowledgePopularityDecile(offer: Partial<VehicleOffer> | any) {
  const raw = offer?.operational?.raw || {};
  return positive(
    raw?.vehicleKnowledgeModel?.popularityDecile
      || raw?.vehicleKnowledge?.popularityDecile
      || raw?.popularityDecile,
    10,
  ) || 10;
}

function offerPowerHp(offer: Partial<VehicleOffer> | any) {
  const raw = offer?.operational?.raw || {};
  return positive(
    offer?.powerHp
      || offer?.representativePowerHp
      || raw?.vehicleKnowledgeModel?.representativePowerHp,
    2_500,
  );
}

function offerAgeYears(offer: Partial<VehicleOffer> | any) {
  const year = positive(offer?.year, new Date().getFullYear() + 2);
  return year ? Math.max(0, new Date().getFullYear() - year) : 99;
}

export function catalogPublicPriority(offer: Partial<VehicleOffer> | any): CatalogPublicPriority {
  const japanAuction = isJapanAuctionOffer(offer);
  const calculated = completeCalculation(offer);
  const preliminary = preliminaryPowerPendingCalculation(offer);
  const visibleRub = catalogOfferVisibleRub(offer);
  const ageYears = offerAgeYears(offer);
  const powerHp = offerPowerHp(offer);
  const popularityDecile = knowledgePopularityDecile(offer);
  const imageCount = Array.isArray(offer?.images) ? offer.images.length : 0;
  const { preferredMaximumRub, absoluteMaximumRub } = publicPriceLimits();
  const maximumPowerHp = Math.max(50, Number(process.env.CATALOG_PRIORITY_MAX_POWER_HP || 160));
  const maximumAgeYears = Math.max(1, Number(process.env.CATALOG_PRIORITY_MAX_AGE_YEARS || 6));
  const popularDecile = Math.max(1, Math.min(10, Number(process.env.CATALOG_PRIORITY_POPULARITY_DECILE || 5)));
  const rawTotalRub = Math.round(positive(offer?.totalRub, 1_000_000_000));
  const base = { visibleRub, ageYears, powerHp, popularityDecile, calculated, preliminary, imageCount, japanAuction };

  if (!calculated && !preliminary) return { eligible: false, tier: 99, reason: "missing_full_calculation", ...base };
  if (!regionalPhotoIdentityVerified(offer)) return { eligible: false, tier: 99, reason: "unverified_regional_photo_identity", ...base };
  if (!rawTotalRub) return { eligible: false, tier: 99, reason: "missing_ruble_price", ...base };
  if (rawTotalRub > absoluteMaximumRub) return { eligible: false, tier: 99, reason: "above_absolute_price_limit", ...base };
  if (!visibleRub) return { eligible: false, tier: 99, reason: "missing_ruble_price", ...base };

  if (preliminary) {
    return { eligible: true, tier: rawTotalRub <= preferredMaximumRub ? 8 : 9, reason: "preliminary_power_pending", ...base };
  }

  const recent = ageYears <= maximumAgeYears;
  const economicalPower = powerHp > 0 && powerHp <= maximumPowerHp;
  const popular = popularityDecile <= popularDecile;
  const preferredPrice = rawTotalRub <= preferredMaximumRub;
  let tier = preferredPrice ? 6 : 7;
  let reason = japanAuction ? "japan_auction_calculated" : preferredPrice ? "calculated_under_preferred_price" : "calculated_above_preferred_price";
  if (preferredPrice && recent && economicalPower && popular) { tier = 1; reason = "popular_recent_economical_calculated"; }
  else if (preferredPrice && recent && economicalPower) { tier = 2; reason = "recent_economical_calculated"; }
  else if (preferredPrice && popular) { tier = 3; reason = "popular_calculated"; }
  else if (japanAuction && preferredPrice) { tier = 4; reason = "japan_auction_calculated"; }
  return { eligible: true, tier, reason, ...base };
}

export function compareCatalogPublicPriority(left: Partial<VehicleOffer> | any, right: Partial<VehicleOffer> | any) {
  const a = catalogPublicPriority(left);
  const b = catalogPublicPriority(right);
  return Number(b.eligible) - Number(a.eligible)
    || a.tier - b.tier
    || Number(b.calculated) - Number(a.calculated)
    || b.imageCount - a.imageCount
    || a.ageYears - b.ageYears
    || a.popularityDecile - b.popularityDecile
    || a.visibleRub - b.visibleRub
    || Date.parse(String(right?.updatedAt || "")) - Date.parse(String(left?.updatedAt || ""));
}

function normalizedPeerIdentity(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("ru-RU");
}

function pricePeerGroup(offer: Partial<VehicleOffer> | any) {
  const market = normalizedPeerIdentity(offer?.market);
  const make = normalizedPeerIdentity(offer?.make);
  const model = normalizedPeerIdentity(offer?.model);
  const saleMode = String(offer?.priceMode || "").toLowerCase() === "auction_start" ? "auction_start" : "fixed";
  const kind = String(offer?.powertrainKind || "").toLowerCase();
  const fuel = String(offer?.fuel || "").toLowerCase();
  const powertrain = ["electric", "series_hybrid", "other_hybrid"].includes(kind)
    || /electric|battery|\bbev\b|\bev\b|hybrid|phev|hev|mhev|электро|гибрид/i.test(fuel)
    ? "electrified"
    : "combustion";
  return market && make && model ? `${market}|${make}|${model}|${saleMode}|${powertrain}` : "";
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function findCatalogPriceOutliers(offers: Array<Partial<VehicleOffer> | any>): CatalogPriceOutlier[] {
  const minimumPeers = Math.max(3, Number(process.env.CATALOG_PRICE_OUTLIER_MIN_PEERS || 3));
  const maximumMedianRatio = Math.max(3, Number(process.env.CATALOG_PRICE_OUTLIER_MAX_MEDIAN_RATIO || 5));
  const maximumYearDistance = Math.max(0, Number(process.env.CATALOG_PRICE_OUTLIER_MAX_YEAR_DISTANCE || 2));
  const groups = new Map<string, Array<{ offer: any; totalRub: number; year: number }>>();

  for (const offer of offers) {
    const key = pricePeerGroup(offer);
    const totalRub = catalogOfferVisibleRub(offer);
    const year = positive(offer?.year, new Date().getFullYear() + 2);
    if (!key || !totalRub || !year) continue;
    groups.set(key, [...(groups.get(key) || []), { offer, totalRub, year }]);
  }

  const outliers: CatalogPriceOutlier[] = [];
  for (const rows of groups.values()) {
    for (const row of rows) {
      const peers = rows
        .filter((candidate) => candidate.offer?.id !== row.offer?.id && Math.abs(candidate.year - row.year) <= maximumYearDistance)
        .map((candidate) => candidate.totalRub)
        .filter((value) => value > 0);
      if (peers.length < minimumPeers) continue;
      const peerMedianRub = median(peers);
      if (!peerMedianRub) continue;
      const ratioToMedian = row.totalRub / peerMedianRub;
      const direction = ratioToMedian >= maximumMedianRatio
        ? "above"
        : ratioToMedian <= 1 / maximumMedianRatio
          ? "below"
          : null;
      if (!direction) continue;
      outliers.push({
        id: String(row.offer?.id || ""),
        market: String(row.offer?.market || ""),
        make: String(row.offer?.make || ""),
        model: String(row.offer?.model || ""),
        year: row.year,
        totalRub: row.totalRub,
        peerMedianRub,
        peerCount: peers.length,
        ratioToMedian: Math.round(ratioToMedian * 100) / 100,
        direction,
      });
    }
  }
  return outliers;
}
