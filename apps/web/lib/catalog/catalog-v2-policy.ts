import type { VehicleOffer } from "./types";

export type CatalogV2Tier = "japan_auction" | "priority" | "recent" | "extended" | "rejected";
export type CatalogV2PolicyOptions = { priorityTarget: number; maximumPerMarket: number; priorityMaxAgeYears: number; recentMaxAgeYears: number; priorityMaxPowerHp: number; priorityMaxTotalRub: number; hardMaxTotalRub: number };
export type CatalogV2Classification = { tier: CatalogV2Tier; eligible: boolean; reason: string; ageYears?: number; totalRub?: number; powerHp?: number; popularityDecile?: number };
export type CatalogV2Selection = { selected: VehicleOffer[]; priorityCount: number; auctionCount: number; recentCount: number; extendedCount: number; fallbackUnlocked: boolean; shortageToUnlock: number; rejected: Record<string, number> };

export const CATALOG_V2_DEFAULT_POLICY: CatalogV2PolicyOptions = { priorityTarget: 1_000, maximumPerMarket: 100_000, priorityMaxAgeYears: 6, recentMaxAgeYears: 15, priorityMaxPowerHp: 160, priorityMaxTotalRub: 6_000_000, hardMaxTotalRub: 100_000_000 };

function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined; }
function currentAge(year: unknown) { const parsed = number(year); return parsed ? Math.max(0, new Date().getFullYear() - parsed) : undefined; }
function rawObject(offer: Partial<VehicleOffer>) { const raw = offer.operational?.raw; return typeof raw === "object" && raw ? raw as Record<string, unknown> : {}; }
function popularityDecile(offer: Partial<VehicleOffer>) { const raw = rawObject(offer); const knowledge = typeof raw.vehicleKnowledge === "object" && raw.vehicleKnowledge ? raw.vehicleKnowledge as Record<string, unknown> : {}; return number(knowledge.popularityDecile ?? raw.popularityDecile ?? raw.knowledgePopularityDecile); }
function hasCompleteCalculation(offer: Partial<VehicleOffer>) { const totalRub = number(offer.totalRub); const customs = offer.calculationSnapshot?.customs; const breakdown = offer.calculationSnapshot?.breakdown; if (!totalRub || customs?.status !== "ready" || !number(customs.totalCustomsRub) || !Array.isArray(breakdown)) return false; const ids = new Set(breakdown.map((line) => String(line?.id || ""))); return ids.has("car") && ids.has("customs"); }
function hasPendingCalculation(offer: Partial<VehicleOffer>) { const status = String(offer.calculationStatus || ""); return !number(offer.totalRub) && (status === "needs_data" || status.startsWith("needs_")); }

const REQUEST_PRICE = /(?:price\s*(?:on|upon)\s*request|contact\s*(?:us\s*)?(?:for\s*)?price|call\s*for\s*price|по\s*запросу|цен[ау]\s*уточняйте|договорн(?:ая|ую|ой)?\s*цен|가격\s*문의|가격문의|문의\s*가격)/iu;
function priceText(offer: Partial<VehicleOffer>) { const raw = rawObject(offer); return [raw.priceText, raw.priceLabel, raw.displayPrice, raw.sourcePriceText, raw.salePriceText, raw.price, raw.salePrice].filter((value) => typeof value === "string").join(" "); }
export function hasExplicitSourcePrice(offer: Partial<VehicleOffer>) { return Boolean(number(offer.sourcePrice) && String(offer.sourceCurrency || "").trim() && !REQUEST_PRICE.test(priceText(offer))); }
function hasSourceCalculationInputs(offer: Partial<VehicleOffer>) { return Boolean(hasExplicitSourcePrice(offer) && number(offer.year) && number(offer.powerHp)); }

const SEDAN_MODEL = /\b(?:k3|k5|k7|k8|avante|elantra|sonata|grandeur|azera|g70|g80|g90|camry|corolla|accord|civic|a6|a8|3\s*series|5\s*series|7\s*series)\b/i;
const SUV_MODEL = /\b(?:tucson|santa\s*fe|sorento|sportage|palisade|kona|seltos|casper|venue|gv60|gv70|gv80|rav4|harrier|cr-v|cx-3|cx-30|cx-4|cx-5|cx-8|cx-9|x1|x2|x3|x4|x5|x6|x7|q3|q5|q7|q8|glc|gle|gls)\b/i;
function removeConflictingBodyDefault(offer: VehicleOffer) {
  const body = String((offer as any).bodyType || "").toLowerCase();
  const model = `${String((offer as any).make || "")} ${String((offer as any).model || "")}`;
  const claimsSuv = /^(?:suv|crossover|offroad|кроссовер|внедорожник)$/.test(body);
  const claimsSedan = /^(?:sedan|saloon|седан)$/.test(body);
  if ((claimsSuv && SEDAN_MODEL.test(model)) || (claimsSedan && SUV_MODEL.test(model))) {
    return { ...offer, bodyType: undefined } as VehicleOffer;
  }
  return offer;
}

export function isJapanAuctionOffer(offer: Partial<VehicleOffer>) { if (offer.market !== "japan") return false; const raw = rawObject(offer); const sourceId = String(offer.sourceId || "").toLowerCase(); const venue = String(offer.auctionName || offer.operational?.sourceVenueName || "").toLowerCase(); const rawKind = String(raw.catalogKind || raw.offerType || raw.auctionType || "").toLowerCase(); return offer.offerType === "auction" || offer.catalogKind === "auction_result" || /(?:auction|auc|jpauc|japantransit|carvector|uss|ju|taa|caa|jaa|arai|haa|zip|aucnet|baya)/.test(sourceId) || /(?:auction|オークション|uss|ju|taa|caa|jaa|arai|haa|zip|aucnet)/i.test(venue) || /(?:auction|auction_result|past_auction)/.test(rawKind); }
export function isCompletedJapanAuction(offer: Partial<VehicleOffer>) { if (!isJapanAuctionOffer(offer)) return false; const raw = rawObject(offer); const sourceId = String(offer.sourceId || "").toLowerCase(); const status = String(raw.auctionStatus || raw.saleStatus || raw.status || offer.auctionResult || offer.status || "").toLowerCase(); return /(?:past|stat|sold|result|history)/.test(sourceId) || /(?:sold|completed|finished|result|past|落札|成約)/i.test(status); }
function isPriorityOffer(offer: Partial<VehicleOffer>, ageYears: number | undefined, powerHp: number | undefined, totalRub: number | undefined, options: CatalogV2PolicyOptions) { return hasSourceCalculationInputs(offer) && ageYears !== undefined && ageYears <= options.priorityMaxAgeYears && powerHp !== undefined && powerHp <= options.priorityMaxPowerHp && (totalRub === undefined || totalRub <= options.priorityMaxTotalRub); }

export function classifyCatalogV2Offer(offer: Partial<VehicleOffer>, options: CatalogV2PolicyOptions = CATALOG_V2_DEFAULT_POLICY): CatalogV2Classification {
  if (!offer.id || !offer.make || !offer.model || !offer.market) return { tier: "rejected", eligible: false, reason: "identity" };
  const totalRub = number(offer.totalRub), ageYears = currentAge(offer.year), powerHp = number(offer.powerHp), popularity = popularityDecile(offer);
  if (!hasExplicitSourcePrice(offer)) return { tier: "rejected", eligible: false, reason: REQUEST_PRICE.test(priceText(offer)) ? "price_on_request" : "source_price_missing", totalRub, ageYears, powerHp, popularityDecile: popularity };
  const completeCalculation = hasCompleteCalculation(offer), pendingCalculation = hasPendingCalculation(offer), sourceInputs = hasSourceCalculationInputs(offer);
  if (!completeCalculation && !pendingCalculation && !sourceInputs) return { tier: "rejected", eligible: false, reason: "calculation_inputs", totalRub, ageYears, powerHp, popularityDecile: popularity };
  if (totalRub !== undefined && totalRub > options.hardMaxTotalRub) return { tier: "rejected", eligible: false, reason: "hard_price_limit", totalRub, ageYears, powerHp, popularityDecile: popularity };
  const priority = isPriorityOffer(offer, ageYears, powerHp, totalRub, options); const recentMaxAgeYears = Math.max(15, Number(options.recentMaxAgeYears || 0));
  if (offer.market === "japan") {
    if (!isJapanAuctionOffer(offer)) return { tier: "rejected", eligible: false, reason: "japan_non_auction", totalRub, ageYears, powerHp, popularityDecile: popularity };
    if (!isCompletedJapanAuction(offer)) return { tier: "rejected", eligible: false, reason: "japan_auction_not_completed", totalRub, ageYears, powerHp, popularityDecile: popularity };
    return priority ? { tier: "priority", eligible: true, reason: "japan_completed_priority", totalRub, ageYears, powerHp, popularityDecile: popularity } : { tier: "japan_auction", eligible: true, reason: "completed_auction", totalRub, ageYears, powerHp, popularityDecile: popularity };
  }
  if (priority) return { tier: "priority", eligible: true, reason: "source_price_year_power_priority", totalRub, ageYears, powerHp, popularityDecile: popularity };
  if (ageYears !== undefined && ageYears <= recentMaxAgeYears) return { tier: "recent", eligible: true, reason: "recent_2011_plus", totalRub, ageYears, powerHp, popularityDecile: popularity };
  return { tier: "extended", eligible: true, reason: "extended_2011_plus", totalRub, ageYears, powerHp, popularityDecile: popularity };
}

function freshness(offer: Partial<VehicleOffer>) { return Date.parse(String(offer.operational?.sourcePublishedAt || offer.updatedAt || offer.firstSeenAt || "")) || 0; }
function imageCount(offer: Partial<VehicleOffer>) { return Array.isArray(offer.images) ? Math.min(30, offer.images.length) : 0; }
function order(left: VehicleOffer, right: VehicleOffer, options: CatalogV2PolicyOptions) { const a = classifyCatalogV2Offer(left, options), b = classifyCatalogV2Offer(right, options); return (a.popularityDecile ?? 99) - (b.popularityDecile ?? 99) || Number(a.totalRub || Number.MAX_SAFE_INTEGER) - Number(b.totalRub || Number.MAX_SAFE_INTEGER) || imageCount(right) - imageCount(left) || freshness(right) - freshness(left) || String(left.id).localeCompare(String(right.id)); }

export function selectCatalogV2MarketOffers(offers: VehicleOffer[], options: CatalogV2PolicyOptions = CATALOG_V2_DEFAULT_POLICY): CatalogV2Selection {
  const buckets: Record<Exclude<CatalogV2Tier, "rejected">, VehicleOffer[]> = { japan_auction: [], priority: [], recent: [], extended: [] }; const rejected: Record<string, number> = {}; const seen = new Set<string>();
  for (const original of offers) { const offer = removeConflictingBodyDefault(original); if (!offer?.id || seen.has(offer.id)) continue; seen.add(offer.id); const classification = classifyCatalogV2Offer(offer, options); if (!classification.eligible || classification.tier === "rejected") { rejected[classification.reason] = Number(rejected[classification.reason] || 0) + 1; continue; } buckets[classification.tier].push(offer); }
  for (const rows of Object.values(buckets)) rows.sort((left, right) => order(left, right, options));
  const publicationLimit = Math.max(1, Number(options.maximumPerMarket || 0)); const priorityTarget = Math.max(0, Number(options.priorityTarget || 0));
  const fallbackUnlocked = publicationLimit <= 10 || buckets.priority.length >= priorityTarget;
  const fallbackRows = [...buckets.japan_auction, ...buckets.recent, ...buckets.extended]; const selected = [...buckets.priority, ...(fallbackUnlocked ? fallbackRows : [])].slice(0, publicationLimit);
  return { selected, priorityCount: selected.filter((offer) => classifyCatalogV2Offer(offer, options).tier === "priority").length, auctionCount: selected.filter((offer) => isCompletedJapanAuction(offer)).length, recentCount: selected.filter((offer) => classifyCatalogV2Offer(offer, options).tier === "recent").length, extendedCount: selected.filter((offer) => classifyCatalogV2Offer(offer, options).tier === "extended").length, fallbackUnlocked, shortageToUnlock: Math.max(0, priorityTarget - buckets.priority.length), rejected: { ...rejected, fallback_locked: fallbackUnlocked ? 0 : fallbackRows.length } };
}
