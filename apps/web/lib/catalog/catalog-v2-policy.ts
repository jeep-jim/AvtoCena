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
  maximumPerMarket: 100_000,
  priorityMaxAgeYears: 6,
  recentMaxAgeYears: 15,
  priorityMaxPowerHp: 160,
  priorityMaxTotalRub: 6_000_000,
  hardMaxTotalRub: 100_000_000,
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

function hasPendingCalculation(offer: Partial<VehicleOffer>) {
  const status = String(offer.calculationStatus || "");
  return !number(offer.totalRub) && (status === "needs_data" || status.startsWith("needs_"));
}

export function isJapanAuctionOffer(offer: Partial<VehicleOffer>) {
  if (offer.market !== "japan") return false;
  const raw = rawObject(offer);
  const sourceId = String(offer.sourceId || "").toLowerCase();
  const venue = String(offer.auctionName || offer.operational?.sourceVenueName || "").toLowerCase();
  const rawKind = String(raw.catalogKind || raw.offerType || raw.auctionType || "").toLowerCase();
  return offer.offerType === "auction"
    || offer.catalogKind === "auction_result"
    || /(?:auction|auc|jpauc|japantransit|carvector|uss|ju|taa|caa|jaa|arai|haa|zip|aucnet|baya)/.test(sourceId)
    || /(?:auction|オークション|uss|ju|taa|caa|jaa|arai|haa|zip|aucnet)/i.test(venue)
    || /(?:auction|auction_result|past_auction)/.test(rawKind);
}

export function isCompletedJapanAuction(offer: Partial<VehicleOffer>) {
  if (!isJapanAuctionOffer(offer)) return false;
  const raw = rawObject(offer);
  const sourceId = String(offer.sourceId || "").toLowerCase();
  const status = String(raw.auctionStatus || raw.saleStatus || raw.status || offer.auctionResult || offer.status || "").toLowerCase();
  const sourceMarksHistory = /(?:past|stat|sold|result|history)/.test(sourceId);
  const statusMarksCompleted = /(?:sold|completed|finished|result|past|落札|成約)/i.test(status);
  return sourceMarksHistory || statusMarksCompleted;
}

function isPriorityOffer(
  completeCalculation: boolean,
  ageYears: number | undefined,
  powerHp: number | undefined,
  totalRub: number | undefined,
  options: CatalogV2PolicyOptions,
) {
  return completeCalculation
    && ageYears !== undefined
    && ageYears <= options.priorityMaxAgeYears
    && powerHp !== undefined
    && powerHp <= options.priorityMaxPowerHp
    && totalRub !== undefined
    && totalRub <= options.priorityMaxTotalRub;
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
  const completeCalculation = hasCompleteCalculation(offer);
  const pendingCalculation = hasPendingCalculation(offer);
  if (!completeCalculation && !pendingCalculation) {
    return { tier: "rejected", eligible: false, reason: "full_calculation", totalRub, ageYears, powerHp, popularityDecile: popularity };
  }
  if (completeCalculation && !totalRub) {
    return { tier: "rejected", eligible: false, reason: "price_missing", totalRub, ageYears, powerHp, popularityDecile: popularity };
  }
  if (totalRub !== undefined && totalRub > options.hardMaxTotalRub) {
    return { tier: "rejected", eligible: false, reason: "hard_price_limit", totalRub, ageYears, powerHp, popularityDecile: popularity };
  }

  const priority = isPriorityOffer(completeCalculation, ageYears, powerHp, totalRub, options);

  if (offer.market === "japan") {
    if (!isJapanAuctionOffer(offer)) {
      return { tier: "rejected", eligible: false, reason: "japan_non_auction", totalRub, ageYears, powerHp, popularityDecile: popularity };
    }
    if (!isCompletedJapanAuction(offer)) {
      return { tier: "rejected", eligible: false, reason: "japan_auction_not_completed", totalRub, ageYears, powerHp, popularityDecile: popularity };
    }
    if (!number(offer.sourcePrice)) {
      return { tier: "rejected", eligible: false, reason: "japan_final_price_missing", totalRub, ageYears, powerHp, popularityDecile: popularity };
    }
    if (priority) {
      return { tier: "priority", eligible: true, reason: "japan_completed_priority", totalRub, ageYears, powerHp, popularityDecile: popularity };
    }
    return {
      tier: "japan_auction",
      eligible: true,
      reason: pendingCalculation ? "completed_auction_calculation_pending" : "completed_auction_after_priority",
      totalRub,
      ageYears,
      powerHp,
      popularityDecile: popularity,
    };
  }

  if (priority) {
    return { tier: "priority", eligible: true, reason: "russia_mass_market", totalRub, ageYears, powerHp, popularityDecile: popularity };
  }
  if (ageYears !== undefined && ageYears <= options.recentMaxAgeYears) {
    return {
      tier: "recent",
      eligible: true,
      reason: pendingCalculation ? "recent_calculation_pending" : "recent_after_priority",
      totalRub,
      ageYears,
      powerHp,
      popularityDecile: popularity,
    };
  }
  return {
    tier: "extended",
    eligible: true,
    reason: pendingCalculation ? "extended_calculation_pending" : "extended_after_priority",
    totalRub,
    ageYears,
    powerHp,
    popularityDecile: popularity,
  };
}

function freshness(offer: Partial<VehicleOffer>) {
  return Date.parse(String(offer.operational?.sourcePublishedAt || offer.updatedAt || offer.firstSeenAt || "")) || 0;
}

function imageCount(offer: Partial<VehicleOffer>) {
  return Array.isArray(offer.images) ? Math.min(30, offer.images.length) : 0;
}

function order(left: VehicleOffer, right: VehicleOffer, options: CatalogV2PolicyOptions) {
  const a = classifyCatalogV2Offer(left, options);
  const b = classifyCatalogV2Offer(right, options);
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
  for (const rows of Object.values(buckets)) rows.sort((left, right) => order(left, right, options));

  const priorityTarget = Math.max(0, Number(options.priorityTarget || 0));
  const fallbackUnlocked = buckets.priority.length >= priorityTarget;
  const fallbackRows = [
    ...buckets.japan_auction,
    ...buckets.recent,
    ...buckets.extended,
  ];
  const publicationLimit = Math.max(100_000, Number(options.maximumPerMarket || 0));
  const selected = [
    ...buckets.priority,
    ...(fallbackUnlocked ? fallbackRows : []),
  ].slice(0, publicationLimit);
  const fallbackLockedCount = fallbackUnlocked ? 0 : fallbackRows.length;

  return {
    selected,
    priorityCount: selected.filter((offer) => classifyCatalogV2Offer(offer, options).tier === "priority").length,
    auctionCount: selected.filter((offer) => isCompletedJapanAuction(offer)).length,
    recentCount: selected.filter((offer) => classifyCatalogV2Offer(offer, options).tier === "recent").length,
    extendedCount: selected.filter((offer) => classifyCatalogV2Offer(offer, options).tier === "extended").length,
    fallbackUnlocked,
    shortageToUnlock: Math.max(0, priorityTarget - buckets.priority.length),
    rejected: {
      ...rejected,
      fallback_locked: fallbackLockedCount,
    },
  };
}
