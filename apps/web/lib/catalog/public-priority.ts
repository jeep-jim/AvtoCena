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

function positive(value: unknown, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= max ? number : 0;
}

export function catalogOfferVisibleRub(offer: Partial<VehicleOffer> | any) {
  const totalRub = positive(offer?.totalRub, 1_000_000_000);
  if (totalRub) return Math.round(totalRub);
  const snapshot = offer?.calculationSnapshot || {};
  const rate = snapshot?.currencyRate || {};
  const explicit = positive(rate?.sourcePriceRub || snapshot?.sourcePriceRub, 1_000_000_000);
  if (explicit) return Math.round(explicit);
  const sourcePrice = positive(offer?.sourcePrice, 1_000_000_000);
  const currency = String(offer?.sourceCurrency || "").toUpperCase();
  if (sourcePrice && currency === "RUB") return Math.round(sourcePrice);
  const effectiveRate = positive(rate?.effectiveRate, 1_000_000);
  return sourcePrice && effectiveRate ? Math.round(sourcePrice * effectiveRate) : 0;
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
  const visibleRub = catalogOfferVisibleRub(offer);
  const ageYears = offerAgeYears(offer);
  const powerHp = offerPowerHp(offer);
  const popularityDecile = knowledgePopularityDecile(offer);
  const calculated = positive(offer?.totalRub, 1_000_000_000) > 0 && String(offer?.calculationStatus || "") === "calculated";
  const imageCount = Array.isArray(offer?.images) ? offer.images.length : 0;
  const maximumRub = Math.max(1_000_000, Number(process.env.CATALOG_PUBLIC_MAX_TOTAL_RUB || 6_000_000));
  const absoluteMaximumRub = Math.max(maximumRub, Number(process.env.CATALOG_PUBLIC_ABSOLUTE_MAX_TOTAL_RUB || 15_000_000));
  const maximumPowerHp = Math.max(50, Number(process.env.CATALOG_PRIORITY_MAX_POWER_HP || 160));
  const maximumAgeYears = Math.max(1, Number(process.env.CATALOG_PRIORITY_MAX_AGE_YEARS || 6));
  const popularDecile = Math.max(1, Math.min(10, Number(process.env.CATALOG_PRIORITY_POPULARITY_DECILE || 5)));

  if (japanAuction) return { eligible: true, tier: 0, reason: "japan_auction_unchanged", visibleRub, ageYears, powerHp, popularityDecile, calculated, imageCount, japanAuction };
  if (!visibleRub) return { eligible: false, tier: 99, reason: "missing_ruble_price", visibleRub, ageYears, powerHp, popularityDecile, calculated, imageCount, japanAuction };
  if (visibleRub > absoluteMaximumRub) return { eligible: false, tier: 99, reason: "above_absolute_price_limit", visibleRub, ageYears, powerHp, popularityDecile, calculated, imageCount, japanAuction };
  if (visibleRub > maximumRub) return { eligible: false, tier: 99, reason: "above_public_price_limit", visibleRub, ageYears, powerHp, popularityDecile, calculated, imageCount, japanAuction };

  const recent = ageYears <= maximumAgeYears;
  const economicalPower = powerHp > 0 && powerHp <= maximumPowerHp;
  const popular = popularityDecile <= popularDecile;
  let tier = 5;
  let reason = "within_6m_fallback";
  if (recent && economicalPower && popular && calculated) { tier = 1; reason = "popular_recent_economical_calculated"; }
  else if (recent && economicalPower && popular) { tier = 2; reason = "popular_recent_economical"; }
  else if (recent && economicalPower && calculated) { tier = 3; reason = "recent_economical_calculated"; }
  else if (recent && economicalPower) { tier = 4; reason = "recent_economical"; }
  else if (popular && calculated) { tier = 5; reason = "popular_calculated_under_6m"; }
  else { tier = 6; reason = "under_6m_fallback"; }
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
