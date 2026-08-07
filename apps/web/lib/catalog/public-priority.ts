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
  const maximumRub = Math.max(1_000_000, Number(process.env.CATALOG_PUBLIC_MAX_TOTAL_RUB || 6_000_000));
  const absoluteMaximumRub = Math.max(maximumRub, Number(process.env.CATALOG_PUBLIC_ABSOLUTE_MAX_TOTAL_RUB || 15_000_000));
  return { maximumRub, absoluteMaximumRub };
}

export function catalogOfferVisibleRub(offer: Partial<VehicleOffer> | any) {
  if (!completeCalculation(offer)) return 0;
  const totalRub = Math.round(positive(offer?.totalRub, 1_000_000_000));
  if (!totalRub) return 0;
  const { maximumRub, absoluteMaximumRub } = publicPriceLimits();
  if (totalRub > absoluteMaximumRub) return 0;
  if (!isJapanAuctionOffer(offer) && totalRub > maximumRub) return 0;
  return totalRub;
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
  const visibleRub = catalogOfferVisibleRub(offer);
  const ageYears = offerAgeYears(offer);
  const powerHp = offerPowerHp(offer);
  const popularityDecile = knowledgePopularityDecile(offer);
  const imageCount = Array.isArray(offer?.images) ? offer.images.length : 0;
  const { maximumRub, absoluteMaximumRub } = publicPriceLimits();
  const maximumPowerHp = Math.max(50, Number(process.env.CATALOG_PRIORITY_MAX_POWER_HP || 160));
  const maximumAgeYears = Math.max(1, Number(process.env.CATALOG_PRIORITY_MAX_AGE_YEARS || 6));
  const popularDecile = Math.max(1, Math.min(10, Number(process.env.CATALOG_PRIORITY_POPULARITY_DECILE || 5)));
  const rawTotalRub = Math.round(positive(offer?.totalRub, 1_000_000_000));

  if (!calculated) return { eligible: false, tier: 99, reason: "missing_full_calculation", visibleRub, ageYears, powerHp, popularityDecile, calculated, imageCount, japanAuction };
  if (!regionalPhotoIdentityVerified(offer)) return { eligible: false, tier: 99, reason: "unverified_regional_photo_identity", visibleRub, ageYears, powerHp, popularityDecile, calculated, imageCount, japanAuction };
  if (!rawTotalRub) return { eligible: false, tier: 99, reason: "missing_ruble_price", visibleRub, ageYears, powerHp, popularityDecile, calculated, imageCount, japanAuction };
  if (rawTotalRub > absoluteMaximumRub) return { eligible: false, tier: 99, reason: "above_absolute_price_limit", visibleRub, ageYears, powerHp, popularityDecile, calculated, imageCount, japanAuction };
  if (!japanAuction && rawTotalRub > maximumRub) return { eligible: false, tier: 99, reason: "above_public_price_limit", visibleRub, ageYears, powerHp, popularityDecile, calculated, imageCount, japanAuction };
  if (!visibleRub) return { eligible: false, tier: 99, reason: "missing_ruble_price", visibleRub, ageYears, powerHp, popularityDecile, calculated, imageCount, japanAuction };

  const recent = ageYears <= maximumAgeYears;
  const economicalPower = powerHp > 0 && powerHp <= maximumPowerHp;
  const popular = popularityDecile <= popularDecile;
  let tier = 6;
  let reason = japanAuction ? "japan_auction_calculated" : "calculated_under_6m";
  if (recent && economicalPower && popular) { tier = 1; reason = "popular_recent_economical_calculated"; }
  else if (recent && economicalPower) { tier = 2; reason = "recent_economical_calculated"; }
  else if (popular) { tier = 3; reason = "popular_calculated"; }
  else if (japanAuction) { tier = 4; reason = "japan_auction_calculated"; }
  return { eligible: true, tier, reason, visibleRub, ageYears, powerHp, popularityDecile, calculated, imageCount, japanAuction };
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
