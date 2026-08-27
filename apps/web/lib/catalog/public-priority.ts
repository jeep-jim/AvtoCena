import type { VehicleOffer } from "./types";
import { isCatalogPowerScenario } from "./power-scenario";

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

export const CATALOG_PUBLIC_HARD_MAX_TOTAL_RUB = 15_000_000;
export const CATALOG_PUBLIC_MAX_TOTAL_TO_CAR_PRICE_RATIO = 8;

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

function summedThirtyMinutePowerKw(offer: Partial<VehicleOffer> | any) {
  const direct = positive(offer?.power30MinKw, 2_000);
  if (direct) return direct;
  const motors = Array.isArray(offer?.power30MinKwByMotor)
    ? offer.power30MinKwByMotor.map((value: unknown) => positive(value, 2_000)).filter(Boolean)
    : [];
  return motors.length ? motors.reduce((sum: number, value: number) => sum + value, 0) : 0;
}

function attestedPublicProjectionRub(offer: Partial<VehicleOffer> | any) {
  const status = String(offer?.calculationStatus || "");
  const pricingConfidence = String(offer?.calculationSnapshot?.pricingConfidence || "");
  if (Number(offer?.cardProjectionVersion || 0) < 3
    || offer?.publicSpecificationVerified !== true
    || !["ready", "estimated", "auction_start", "calculated"].includes(status)
    || pricingConfidence === "preliminary") return 0;
  return Math.round(positive(offer?.publicVisibleRub, 1_000_000_000));
}

export function catalogRequiredSpecificationRejectionReason(offer: Partial<VehicleOffer> | any) {
  // V3 compact rows carry a server-side attestation made while the complete
  // offer (including customs-critical power fields) is still in memory. The
  // compact public read model may omit those bulky/raw dependencies, so do not
  // reclassify an already verified projection as incomplete in the card layer.
  if (attestedPublicProjectionRub(offer)) return "";
  const kind = String(offer?.powertrainKind || "").toLowerCase();
  const engineCc = positive(offer?.engineCc, 10_000);
  const powerHp = positive(offer?.powerHp, 2_500);
  const powerKw = positive(offer?.powerKw, 2_000);
  const icePowerKw = positive(offer?.icePowerKw, 2_000);
  const thirtyMinutePowerKw = summedThirtyMinutePowerKw(offer);
  const utilizationPowerKw = positive(
    offer?.utilizationPowerKw || offer?.calculationSnapshot?.customs?.utilizationPowerKw,
    2_000,
  );
  if (isCatalogPowerScenario(offer)) {
    if (["combustion", "series_hybrid", "other_hybrid"].includes(kind) && !engineCc) return "missing_engine_cc";
    if (kind === "unknown" || !kind) return "unknown_powertrain_kind";
    if (!powerHp && !powerKw) return "missing_peak_power";
    if (!utilizationPowerKw) return "missing_utilization_power_kw";
    return "";
  }

  if (kind === "combustion") {
    if (!engineCc) return "missing_engine_cc";
    if (!powerHp) return "missing_power_hp";
    return "";
  }
  if (kind === "electric") {
    if (!powerKw && !powerHp) return "missing_peak_power";
    if (!thirtyMinutePowerKw) return "missing_certified_30min_kw";
    if (!utilizationPowerKw) return "missing_utilization_power_kw";
    return "";
  }
  if (kind === "series_hybrid" || kind === "other_hybrid") {
    if (!engineCc) return "missing_engine_cc";
    if (!icePowerKw) return "missing_ice_power_kw";
    if (!powerKw && !powerHp) return "missing_peak_power";
    if (!thirtyMinutePowerKw) return "missing_certified_30min_kw";
    if (!utilizationPowerKw) return "missing_utilization_power_kw";
    return "";
  }
  return "unknown_powertrain_kind";
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

export function japanAuctionSoldIdentityVerified(offer: Partial<VehicleOffer> | any) {
  if (!isJapanAuctionOffer(offer)) return true;
  const raw = offer?.operational?.raw || {};
  const structuralIdentity = offer?.offerType === "auction"
    && offer?.catalogKind === "auction_result"
    && offer?.auctionResult === "sold"
    && offer?.auctionPriceKind === "published_result";
  const rawIdentity = raw?.listingBoundImages === true
    && raw?.photoIdentityVerified === true
    && raw?.recoveryExactSourceUrl === true
    && raw?.recoveryExactPhotoIdentity === true;
  const persistedIdentity = offer?.operational?.publicJapanSoldIdentityVerified === true;
  return structuralIdentity && (rawIdentity || persistedIdentity);
}

export function japanAuctionSoldPriceVerified(offer: Partial<VehicleOffer> | any) {
  if (!isJapanAuctionOffer(offer) || !japanAuctionSoldIdentityVerified(offer)) return false;
  const raw = offer?.operational?.raw || {};
  const sourcePriceJpy = positive(offer?.sourcePrice, 1_000_000_000);
  const finalPriceJpy = positive(raw?.finalPriceJpy, 1_000_000_000);
  return String(offer?.sourceCurrency || "").toUpperCase() === "JPY"
    && sourcePriceJpy > 0
    && finalPriceJpy > 0
    && Math.abs(sourcePriceJpy - finalPriceJpy) <= 1;
}

function publicPriceLimits() {
  // The preferred limit only affects ordering. The 15M ceiling is a product
  // invariant for a displayed delivered price. Inventory with an unfinished
  // calculation can still be shown, but it receives no public delivered total.
  const requestedPreferredRub = Number(process.env.CATALOG_PUBLIC_MAX_TOTAL_RUB || 8_000_000);
  const requestedAbsoluteRub = Number(process.env.CATALOG_PUBLIC_ABSOLUTE_MAX_TOTAL_RUB || CATALOG_PUBLIC_HARD_MAX_TOTAL_RUB);
  const absoluteMaximumRub = Math.min(
    CATALOG_PUBLIC_HARD_MAX_TOTAL_RUB,
    Math.max(1_000_000, Number.isFinite(requestedAbsoluteRub) ? requestedAbsoluteRub : CATALOG_PUBLIC_HARD_MAX_TOTAL_RUB),
  );
  const preferredMaximumRub = Math.min(
    absoluteMaximumRub,
    Math.max(1_000_000, Number.isFinite(requestedPreferredRub) ? requestedPreferredRub : 8_000_000),
  );
  return { preferredMaximumRub, absoluteMaximumRub };
}

export function catalogOfferCarPriceRub(offer: Partial<VehicleOffer> | any) {
  const ratePrice = Math.round(positive(offer?.calculationSnapshot?.currencyRate?.sourcePriceRub, 1_000_000_000));
  if (ratePrice) return ratePrice;
  return Math.round(positive(offer?.calculationSnapshot?.sourcePriceRub, 1_000_000_000));
}

export function catalogPublicEconomicRejectionReason(offer: Partial<VehicleOffer> | any) {
  const totalRub = Math.round(positive(offer?.totalRub, 1_000_000_000));
  if (!totalRub) return "";
  const { absoluteMaximumRub } = publicPriceLimits();
  if (totalRub > absoluteMaximumRub) return "above_public_price_limit";
  const carPriceRub = catalogOfferCarPriceRub(offer);
  const requestedRatio = Number(process.env.CATALOG_PUBLIC_MAX_TOTAL_TO_CAR_PRICE_RATIO || CATALOG_PUBLIC_MAX_TOTAL_TO_CAR_PRICE_RATIO);
  const maximumRatio = Math.min(
    CATALOG_PUBLIC_MAX_TOTAL_TO_CAR_PRICE_RATIO,
    Math.max(1, Number.isFinite(requestedRatio) ? requestedRatio : CATALOG_PUBLIC_MAX_TOTAL_TO_CAR_PRICE_RATIO),
  );
  if (carPriceRub > 0\n    && totalRub / carPriceRub >= maximumRatio\n    && !japanAuctionSoldPriceVerified(offer)) return "total_to_car_price_ratio";
  return "";
}

export function catalogOfferVisibleRub(offer: Partial<VehicleOffer> | any) {
  // Never trust a legacy projected amount without re-checking the underlying
  // calculation contract. Unfinished calculations may remain visible as
  // inventory, but they never expose a delivered price.
  const status = String(offer?.calculationStatus || "");
  const pricingConfidence = String(offer?.calculationSnapshot?.pricingConfidence || "");
  const attestedProjectionRub = attestedPublicProjectionRub(offer);
  if (attestedProjectionRub) {
    const { absoluteMaximumRub } = publicPriceLimits();
    return attestedProjectionRub <= absoluteMaximumRub ? attestedProjectionRub : 0;
  }
  const projectionVersion = Number(offer?.cardProjectionVersion || 0);
  const validatedProjection = projectionVersion >= 2
    || (projectionVersion === 1
      && ["ready", "estimated", "auction_start", "calculated"].includes(status)
      && pricingConfidence !== "preliminary");
  if (!completeCalculation(offer) && !validatedProjection) return 0;
  if (catalogRequiredSpecificationRejectionReason(offer)) return 0;
  if (catalogPublicEconomicRejectionReason(offer)) return 0;
  const projectedVisibleRub = Math.round(positive(offer?.publicVisibleRub, 1_000_000_000));
  if (projectedVisibleRub) {
    const { absoluteMaximumRub } = publicPriceLimits();
    return projectedVisibleRub <= absoluteMaximumRub ? projectedVisibleRub : 0;
  }
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
  const { preferredMaximumRub } = publicPriceLimits();
  const maximumPowerHp = Math.max(50, Number(process.env.CATALOG_PRIORITY_MAX_POWER_HP || 160));
  const maximumAgeYears = Math.max(1, Number(process.env.CATALOG_PRIORITY_MAX_AGE_YEARS || 6));
  const popularDecile = Math.max(1, Math.min(10, Number(process.env.CATALOG_PRIORITY_POPULARITY_DECILE || 5)));
  const rawTotalRub = Math.round(positive(offer?.totalRub, 1_000_000_000));
  const specificationRejection = catalogRequiredSpecificationRejectionReason(offer);
  const sourcePriced = positive(offer?.sourcePrice, 1_000_000_000) > 0 && Boolean(String(offer?.sourceCurrency || "").trim());
  const base = { visibleRub, ageYears, powerHp, popularityDecile, calculated, preliminary, imageCount, japanAuction };

  if (japanAuction && !japanAuctionSoldIdentityVerified(offer)) return { eligible: false, tier: 99, reason: "japan_auction_sold_identity_unverified", ...base };
  if (!regionalPhotoIdentityVerified(offer)) return { eligible: false, tier: 99, reason: "unverified_regional_photo_identity", ...base };

  // The public catalog is a delivered-price product, not an internal inventory
  // browser. Keep source-priced rows with unfinished customs inputs in internal
  // storage so the source/CORE recovery pipeline can finish them, but never
  // expose them as a public "price on request" card.
  if (preliminary || !calculated || specificationRejection) {
    if (!sourcePriced) return { eligible: false, tier: 99, reason: "missing_source_price", ...base };
    return {
      eligible: false,
      tier: 99,
      reason: preliminary ? "calculation_pending_power" : specificationRejection || "calculation_pending",
      ...base,
      visibleRub: 0,
    };
  }

  if (!rawTotalRub) return { eligible: false, tier: 99, reason: "missing_ruble_price", ...base };
  const economicRejection = catalogPublicEconomicRejectionReason(offer);
  if (economicRejection) return { eligible: false, tier: 99, reason: economicRejection, ...base };
  if (!visibleRub) return { eligible: false, tier: 99, reason: "missing_ruble_price", ...base };

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
