import type { VehicleOffer } from "./types";

export type CatalogV2Tier = "japan_auction" | "priority" | "recent" | "extended" | "rejected";
export type CatalogV2PolicyOptions = {
  priorityTarget: number;
  maximumPerMarket: number;
  priorityMaxAgeYears: number;
  recentMaxAgeYears: number;
  priorityMaxPowerHp: number;
  priorityMaxTotalRub: number;
  hardMaxTotalRub: number;
  lowPowerMinShare: number;
};
export type CatalogV2Classification = { tier: CatalogV2Tier; eligible: boolean; reason: string; ageYears?: number; totalRub?: number; powerHp?: number; popularityDecile?: number };
export type CatalogV2Selection = { selected: VehicleOffer[]; priorityCount: number; lowPowerCount: number; auctionCount: number; recentCount: number; extendedCount: number; fallbackUnlocked: boolean; shortageToUnlock: number; rejected: Record<string, number> };

export const CATALOG_V2_DEFAULT_POLICY: CatalogV2PolicyOptions = {
  priorityTarget: 24_000,
  maximumPerMarket: 30_000,
  priorityMaxAgeYears: 6,
  recentMaxAgeYears: 15,
  priorityMaxPowerHp: 160,
  priorityMaxTotalRub: 6_000_000,
  hardMaxTotalRub: Number.MAX_SAFE_INTEGER,
  lowPowerMinShare: 0.8,
};

function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined; }
function currentAge(year: unknown) { const parsed = number(year); return parsed ? Math.max(0, new Date().getFullYear() - parsed) : undefined; }
function rawObject(offer: Partial<VehicleOffer>) { const raw = offer.operational?.raw; return typeof raw === "object" && raw ? raw as Record<string, unknown> : {}; }
function popularityDecile(offer: Partial<VehicleOffer>) { const raw = rawObject(offer); const knowledge = typeof raw.vehicleKnowledge === "object" && raw.vehicleKnowledge ? raw.vehicleKnowledge as Record<string, unknown> : {}; return number(knowledge.popularityDecile ?? raw.popularityDecile ?? raw.knowledgePopularityDecile); }

const REQUEST_PRICE = /(?:price\s*(?:on|upon)\s*request|contact\s*(?:us\s*)?(?:for\s*)?price|call\s*for\s*price|по\s*запросу|цен[ау]\s*уточняйте|договорн(?:ая|ую|ой)?\s*цен|가격\s*문의|가격문의|문의\s*가격)/iu;
function priceText(offer: Partial<VehicleOffer>) { const raw = rawObject(offer); return [raw.priceText, raw.priceLabel, raw.displayPrice, raw.sourcePriceText, raw.salePriceText, raw.price, raw.salePrice].filter((value) => typeof value === "string").join(" "); }
export function hasExplicitSourcePrice(offer: Partial<VehicleOffer>) { return Boolean(number(offer.sourcePrice) && String(offer.sourceCurrency || "").trim() && !REQUEST_PRICE.test(priceText(offer))); }

const SEDAN_MODEL = /\b(?:k3|k5|k7|k8|avante|elantra|sonata|grandeur|azera|g70|g80|g90|camry|corolla|accord|civic|a6|a8|3\s*series|5\s*series|7\s*series)\b/i;
const SUV_MODEL = /\b(?:tucson|santa\s*fe|sorento|sportage|palisade|kona|seltos|casper|venue|gv60|gv70|gv80|rav4|harrier|cr-v|cx-3|cx-30|cx-4|cx-5|cx-8|cx-9|x1|x2|x3|x4|x5|x6|x7|q3|q5|q7|q8|glc|gle|gls)\b/i;
function removeConflictingBodyDefault(offer: VehicleOffer) {
  const body = String((offer as any).bodyType || "").toLowerCase();
  const model = `${String((offer as any).make || "")} ${String((offer as any).model || "")}`;
  const claimsSuv = /^(?:suv|crossover|offroad|кроссовер|внедорожник)$/.test(body);
  const claimsSedan = /^(?:sedan|saloon|седан)$/.test(body);
  return (claimsSuv && SEDAN_MODEL.test(model)) || (claimsSedan && SUV_MODEL.test(model)) ? { ...offer, bodyType: undefined } as VehicleOffer : offer;
}

export function isJapanAuctionOffer(offer: Partial<VehicleOffer>) { if (offer.market !== "japan") return false; const raw = rawObject(offer); const sourceId = String(offer.sourceId || "").toLowerCase(); const venue = String(offer.auctionName || offer.operational?.sourceVenueName || "").toLowerCase(); const rawKind = String(raw.catalogKind || raw.offerType || raw.auctionType || "").toLowerCase(); return offer.offerType === "auction" || offer.catalogKind === "auction_result" || /(?:auction|auc|jpauc|japantransit|carvector|uss|ju|taa|caa|jaa|arai|haa|zip|aucnet|baya)/.test(sourceId) || /(?:auction|オークション|uss|ju|taa|caa|jaa|arai|haa|zip|aucnet)/i.test(venue) || /(?:auction|auction_result|past_auction)/.test(rawKind); }
export function isCompletedJapanAuction(offer: Partial<VehicleOffer>) { if (!isJapanAuctionOffer(offer)) return false; const raw = rawObject(offer); const sourceId = String(offer.sourceId || "").toLowerCase(); const status = String(raw.auctionStatus || raw.saleStatus || raw.status || offer.auctionResult || offer.status || "").toLowerCase(); return /(?:past|stat|sold|result|history)/.test(sourceId) || /(?:sold|completed|finished|result|past|落札|成約)/i.test(status); }

/** The commercial priority layer is affordable and <=160 hp. */
export function isCatalogPriorityOffer(offer: Partial<VehicleOffer>, options: CatalogV2PolicyOptions = CATALOG_V2_DEFAULT_POLICY) {
  const totalRub = number(offer.totalRub);
  const powerHp = number(offer.powerHp);
  return totalRub !== undefined
    && totalRub <= options.priorityMaxTotalRub
    && powerHp !== undefined
    && powerHp <= options.priorityMaxPowerHp;
}

/** Low-power share is a separate hard mix contract: at least 80% <=160 hp. */
export function isCatalogLowPowerOffer(offer: Partial<VehicleOffer>, options: CatalogV2PolicyOptions = CATALOG_V2_DEFAULT_POLICY) {
  const powerHp = number(offer.powerHp);
  return powerHp !== undefined && powerHp <= options.priorityMaxPowerHp;
}

export function classifyCatalogV2Offer(offer: Partial<VehicleOffer>, options: CatalogV2PolicyOptions = CATALOG_V2_DEFAULT_POLICY): CatalogV2Classification {
  if (!offer.id || !offer.make || !offer.model || !offer.market) return { tier: "rejected", eligible: false, reason: "identity" };
  const year = number(offer.year), ageYears = currentAge(year), powerHp = number(offer.powerHp), totalRub = number(offer.totalRub), popularity = popularityDecile(offer);
  const minimumYear = offer.market === "japan" ? 2010 : 2020;
  if (!year || year < minimumYear || year > new Date().getFullYear() + 1) return { tier: "rejected", eligible: false, reason: "year", ageYears, powerHp, totalRub, popularityDecile: popularity };
  if (!hasExplicitSourcePrice(offer)) return { tier: "rejected", eligible: false, reason: REQUEST_PRICE.test(priceText(offer)) ? "price_on_request" : "source_price_missing", ageYears, powerHp, totalRub, popularityDecile: popularity };
  if (totalRub !== undefined && totalRub > options.hardMaxTotalRub) return { tier: "rejected", eligible: false, reason: "hard_price_cap", ageYears, powerHp, totalRub, popularityDecile: popularity };
  if (offer.market === "japan" && isJapanAuctionOffer(offer)) {
    if (!isCompletedJapanAuction(offer)) return { tier: "rejected", eligible: false, reason: "japan_auction_not_completed", ageYears, powerHp, totalRub, popularityDecile: popularity };
    return isCatalogPriorityOffer(offer, options)
      ? { tier: "priority", eligible: true, reason: "japan_completed_priority", ageYears, powerHp, totalRub, popularityDecile: popularity }
      : { tier: "japan_auction", eligible: true, reason: "completed_auction", ageYears, powerHp, totalRub, popularityDecile: popularity };
  }
  return isCatalogPriorityOffer(offer, options)
    ? { tier: "priority", eligible: true, reason: "affordable_low_power", ageYears, powerHp, totalRub, popularityDecile: popularity }
    : { tier: "recent", eligible: true, reason: "market_year_eligible", ageYears, powerHp, totalRub, popularityDecile: popularity };
}

function freshness(offer: Partial<VehicleOffer>) { return Date.parse(String(offer.operational?.sourcePublishedAt || offer.updatedAt || offer.firstSeenAt || "")) || 0; }
function imageCount(offer: Partial<VehicleOffer>) { return Array.isArray(offer.images) ? Math.min(30, offer.images.length) : 0; }
function order(left: VehicleOffer, right: VehicleOffer, options: CatalogV2PolicyOptions) {
  const a = classifyCatalogV2Offer(left, options), b = classifyCatalogV2Offer(right, options);
  const lowPowerDelta = Number(isCatalogLowPowerOffer(right, options)) - Number(isCatalogLowPowerOffer(left, options));
  const priorityDelta = Number(isCatalogPriorityOffer(right, options)) - Number(isCatalogPriorityOffer(left, options));
  const tier = (value: CatalogV2Tier) => value === "priority" ? 0 : value === "recent" ? 1 : value === "japan_auction" ? 2 : 3;
  return lowPowerDelta
    || priorityDelta
    || Number(a.ageYears ?? Number.MAX_SAFE_INTEGER) - Number(b.ageYears ?? Number.MAX_SAFE_INTEGER)
    || Number(a.totalRub || Number.MAX_SAFE_INTEGER) - Number(b.totalRub || Number.MAX_SAFE_INTEGER)
    || tier(a.tier) - tier(b.tier)
    || imageCount(right) - imageCount(left)
    || freshness(right) - freshness(left)
    || String(left.id).localeCompare(String(right.id));
}

export function selectCatalogV2MarketOffers(offers: VehicleOffer[], options: CatalogV2PolicyOptions = CATALOG_V2_DEFAULT_POLICY): CatalogV2Selection {
  const accepted: VehicleOffer[] = []; const rejected: Record<string, number> = {}; const seen = new Set<string>();
  for (const original of offers) {
    const offer = removeConflictingBodyDefault(original);
    if (!offer?.id || seen.has(offer.id)) continue;
    seen.add(offer.id);
    const classification = classifyCatalogV2Offer(offer, options);
    if (!classification.eligible) { rejected[classification.reason] = Number(rejected[classification.reason] || 0) + 1; continue; }
    accepted.push(offer);
  }

  accepted.sort((left, right) => order(left, right, options));
  const maximum = Math.max(1, Number(options.maximumPerMarket || 30_000));
  const requestedPriorityTarget = Math.max(0, Math.min(maximum, Number(options.priorityTarget || 0)));
  const minimumLowPowerShare = Math.max(0, Math.min(1, Number(options.lowPowerMinShare ?? 0.8)));
  const lowPower = accepted.filter((offer) => isCatalogLowPowerOffer(offer, options));
  const highPower = accepted.filter((offer) => !isCatalogLowPowerOffer(offer, options));
  const lowPowerNeededForFullMarket = Math.ceil(maximum * minimumLowPowerShare);
  const initialLowPowerCount = Math.min(lowPower.length, lowPowerNeededForFullMarket);
  const selected: VehicleOffer[] = lowPower.slice(0, initialLowPowerCount);
  const proportionalHighPowerLimit = minimumLowPowerShare <= 0
    ? maximum
    : minimumLowPowerShare >= 1
      ? 0
      : Math.floor(initialLowPowerCount * (1 - minimumLowPowerShare) / minimumLowPowerShare);
  const highPowerCount = Math.min(highPower.length, maximum - selected.length, proportionalHighPowerLimit);
  selected.push(...highPower.slice(0, highPowerCount));
  if (selected.length < maximum) selected.push(...lowPower.slice(initialLowPowerCount, initialLowPowerCount + maximum - selected.length));

  const priorityCount = selected.filter((offer) => isCatalogPriorityOffer(offer, options)).length;
  const lowPowerCount = selected.filter((offer) => isCatalogLowPowerOffer(offer, options)).length;
  const shortageToUnlock = Math.max(
    Math.max(0, requestedPriorityTarget - priorityCount),
    Math.max(0, lowPowerNeededForFullMarket - lowPower.length),
  );
  const ratioLocked = Math.max(0, highPower.length - highPowerCount);

  return {
    selected,
    priorityCount,
    lowPowerCount,
    auctionCount: selected.filter((offer) => isCompletedJapanAuction(offer)).length,
    recentCount: selected.filter((offer) => classifyCatalogV2Offer(offer, options).tier === "recent").length,
    extendedCount: 0,
    fallbackUnlocked: minimumLowPowerShare <= 0 || highPowerCount > 0,
    shortageToUnlock,
    rejected: { ...rejected, fallback_locked: ratioLocked },
  };
}
