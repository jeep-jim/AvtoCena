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

function preliminaryElectrifiedCalculation(offer: Partial<VehicleOffer> | any) {
  const totalRub = positive(offer?.totalRub, 1_000_000_000);
  const kind = String(offer?.powertrainKind || "");
  const snapshot = offer?.calculationSnapshot || {};
  const customs = snapshot.customs || {};
  const breakdown = Array.isArray(snapshot.breakdown) ? snapshot.breakdown : [];
  const hasCar = breakdown.some((line: any) => String(line?.id || "") === "car" && positive(line?.amountRub) > 0);
  const hasKnownCustoms = breakdown.some((line: any) => String(line?.id || "") === "customs" && positive(line?.amountRub) > 0);
  return Boolean(totalRub
    && ["electric", "series_hybrid", "other_hybrid"].includes(kind)
    && String(offer?.calculationStatus || "") === "preliminary_power_pending"
    && snapshot.pricingConfidence === "preliminary"
    && snapshot.priceIncludesUtilizationFee === false
    && customs.status === "needs_data"
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
  if (!completeCalculation(offer) && !preliminaryElectrifiedCalculation(offer)) return 0;
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
  const preliminary = preliminaryElectrifiedCalculation(offer);
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
    return { eligible: true, tier: rawTotalRub <= preferredMaximumRub ? 8 : 9, reason: "preliminary_electrified_power_pending", ...base };
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
