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
};

export type CatalogV2Classification = {
  tier: CatalogV2Tier;
  eligible: boolean;
  reason: string;
  ageYears?: number;
  totalRub?: number;
  powerHp?: number;
  popularityDecile?: number;
};

export type CatalogV2Selection = {
  selected: VehicleOffer[];
  priorityCount: number;
  auctionCount: number;
  recentCount: number;
  extendedCount: number;
  fallbackUnlocked: boolean;
  shortageToUnlock: number;
  rejected: Record<string, number>;
};

export const CATALOG_V2_DEFAULT_POLICY: CatalogV2PolicyOptions = {
  priorityTarget: 1_000,
  maximumPerMarket: 30_000,
  priorityMaxAgeYears: 6,
  recentMaxAgeYears: 10,
  priorityMaxPowerHp: 160,
  priorityMaxTotalRub: 6_000_000,
  hardMaxTotalRub: 15_000_000,
};

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function currentAge(year: unknown) {
  const parsed = number(year);
  if (!parsed) return undefined;
  return Math.max(0, new Date().getFullYear() - parsed);
}

function rawObject(offer: Partial<VehicleOffer>) {
  const raw = offer.operational?.raw;
  return typeof raw === "object" && raw ? raw as Record<string, unknown> : {};
}

function popularityDecile(offer: Partial<VehicleOffer>) {
  const raw = rawObject(offer);
  const knowledge = typeof raw.vehicleKnowledge === "object" && raw.vehicleKnowledge
    ? raw.vehicleKnowledge as Record<string, unknown>
    : {};
  return number(knowledge.popularityDecile ?? raw.popularityDecile ?? raw.knowledgePopularityDecile);
}

function hasCompleteCalculation(offer: Partial<VehicleOffer>) {
  const totalRub = number(offer.totalRub);
  const customs = offer.calculationSnapshot?.customs;
  const breakdown = offer.calculationSnapshot?.breakdown;
  if (!totalRub || customs?.status !== "ready" || !number(customs.totalCustomsRub)) return false;
  if (!Array.isArray(breakdown)) return false;
  const ids = new Set(breakdown.map((line) => String(line?.id || "")));
  return ids.has("car") && ids.has("customs");
}

export function isCompletedJapanAuction(offer: Partial<VehicleOffer>) {
  if (offer.market !== "japan") return false;
  const raw = rawObject(offer);
  const sourceId = String(offer.sourceId || "").toLowerCase();
  const status = String(raw.auctionStatus || raw.saleStatus || raw.status || "").toLowerCase();
  const sourceMarksHistory = /(?:past|stat|sold|auction_history)/.test(sourceId);
  const statusMarksCompleted = /(?:sold|completed|finished|result|past|落札|成約)/i.test(status);
  return sourceMarksHistory || statusMarksCompleted;
}

export function classifyCatalogV2Offer(
  offer: Partial<VehicleOffer>,
  options: CatalogV2PolicyOptions = CATALOG_V2_DEFAULT_POLICY,
): CatalogV2Classification {
  if (!offer.id || !offer.make || !offer.model || !offer.market) {
    return { tier: "rejected", eligible: false, reason: "identity" };
  }
  const totalRub = number(offer.totalRub);
  const ageYears = currentAge(offer.year);
  const powerHp = number(offer.powerHp);
  const popularity = popularityDecile(offer);
  if (!hasCompleteCalculation(offer)) {
    return { tier: "rejected", eligible: false, reason: "full_calculation", totalRub, ageYears, powerHp, popularityDecile: popularity };
  }
  if (!totalRub || totalRub > options.hardMaxTotalRub) {
    return { tier: "rejected", eligible: false, reason: "hard_price_limit", totalRub, ageYears, powerHp, popularityDecile: popularity };
  }
  if (isCompletedJapanAuction(offer)) {
    return { tier: "japan_auction", eligible: true, reason: "completed_auction", totalRub, ageYears, powerHp, popularityDecile: popularity };
  }
  const priority = ageYears !== undefined
    && ageYears <= options.priorityMaxAgeYears
    && powerHp !== undefined
    && powerHp <= options.priorityMaxPowerHp
    && totalRub <= options.priorityMaxTotalRub;
  if (priority) {
    return { tier: "priority", eligible: true, reason: "russia_mass_market", totalRub, ageYears, powerHp, popularityDecile: popularity };
  }
  if (ageYears !== undefined && ageYears <= options.recentMaxAgeYears) {
    return { tier: "recent", eligible: true, reason: "fallback_after_priority_target", totalRub, ageYears, powerHp, popularityDecile: popularity };
  }
  return { tier: "extended", eligible: true, reason: "extended_after_priority_target", totalRub, ageYears, powerHp, popularityDecile: popularity };
}

function freshness(offer: Partial<VehicleOffer>) {
  return Date.parse(String(offer.operational?.sourcePublishedAt || offer.updatedAt || offer.firstSeenAt || "")) || 0;
}

function imageCount(offer: Partial<VehicleOffer>) {
  return Array.isArray(offer.images) ? Math.min(30, offer.images.length) : 0;
}

function order(left: VehicleOffer, right: VehicleOffer) {
  const a = classifyCatalogV2Offer(left);
  const b = classifyCatalogV2Offer(right);
  const popularityA = a.popularityDecile ?? 99;
  const popularityB = b.popularityDecile ?? 99;
  return popularityA - popularityB
    || Number(a.totalRub || Number.MAX_SAFE_INTEGER) - Number(b.totalRub || Number.MAX_SAFE_INTEGER)
    || imageCount(right) - imageCount(left)
    || freshness(right) - freshness(left)
    || String(left.id).localeCompare(String(right.id));
}

export function selectCatalogV2MarketOffers(
  offers: VehicleOffer[],
  options: CatalogV2PolicyOptions = CATALOG_V2_DEFAULT_POLICY,
): CatalogV2Selection {
  const buckets: Record<Exclude<CatalogV2Tier, "rejected">, VehicleOffer[]> = {
    japan_auction: [],
    priority: [],
    recent: [],
    extended: [],
  };
  const rejected: Record<string, number> = {};
  const seen = new Set<string>();
  for (const offer of offers) {
    if (!offer?.id || seen.has(offer.id)) continue;
    seen.add(offer.id);
    const classification = classifyCatalogV2Offer(offer, options);
    if (!classification.eligible || classification.tier === "rejected") {
      rejected[classification.reason] = Number(rejected[classification.reason] || 0) + 1;
      continue;
    }
    buckets[classification.tier].push(offer);
  }
  for (const rows of Object.values(buckets)) rows.sort(order);

  const priorityCount = buckets.priority.length;
  const fallbackUnlocked = priorityCount >= options.priorityTarget;
  const base = [...buckets.priority];
  if (buckets.japan_auction.length) base.push(...buckets.japan_auction);
  if (fallbackUnlocked) base.push(...buckets.recent, ...buckets.extended);
  const selected = base.slice(0, options.maximumPerMarket);
  const selectedIds = new Set(selected.map((offer) => offer.id));

  return {
    selected,
    priorityCount: selected.filter((offer) => classifyCatalogV2Offer(offer, options).tier === "priority").length,
    auctionCount: selected.filter((offer) => classifyCatalogV2Offer(offer, options).tier === "japan_auction").length,
    recentCount: selected.filter((offer) => classifyCatalogV2Offer(offer, options).tier === "recent").length,
    extendedCount: selected.filter((offer) => classifyCatalogV2Offer(offer, options).tier === "extended").length,
    fallbackUnlocked,
    shortageToUnlock: Math.max(0, options.priorityTarget - priorityCount),
    rejected: {
      ...rejected,
      fallback_locked: fallbackUnlocked ? 0 : [...buckets.recent, ...buckets.extended].filter((offer) => !selectedIds.has(offer.id)).length,
    },
  };
}
