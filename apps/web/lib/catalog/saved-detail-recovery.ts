import { classifySpecificationEvidence, type SpecificationAuditField } from "./specification-evidence-audit";
import { isAllowedCatalogSourceId, isAllowedCatalogSourceUrl } from "./required-catalog-sources";
import { credibleCatalogImages } from "./offer-quality";
import type { CatalogMarket, VehicleOffer } from "./types";

export const SAVED_DETAIL_RECOVERY_MARKETS = ["uae", "georgia", "korea"] as const;
export type SavedDetailRecoveryMarket = typeof SAVED_DETAIL_RECOVERY_MARKETS[number];

export const SAVED_DETAIL_NEEDS = [
  "sourcePrice",
  "photos",
  "fuelPowertrain",
  "engineCc",
  "powerHp",
  "certifiedPower",
] as const;
export type SavedDetailNeed = typeof SAVED_DETAIL_NEEDS[number];
export type SavedDetailStage = "listing" | "detail";
export type SavedDetailTransport = "direct_fixed_id" | "fixed_id_bridge_required" | "unsupported";

type SourceCapability = {
  market: SavedDetailRecoveryMarket;
  supported: readonly SavedDetailNeed[];
  /** Re-reading an already parsed detail may only repair these transport-bound facts. */
  detailRetry: readonly SavedDetailNeed[];
  transport: SavedDetailTransport;
  minimumImages: number;
};

/**
 * This is deliberately narrower than the source adapter registry. It describes
 * only facts an identity-bound detail response can prove without list paging.
 */
export const SAVED_DETAIL_SOURCE_CAPABILITIES: Readonly<Record<string, SourceCapability>> = {
  carswitch_uae_open: {
    market: "uae",
    supported: ["sourcePrice", "photos", "fuelPowertrain"],
    detailRetry: ["sourcePrice", "photos"],
    transport: "direct_fixed_id",
    minimumImages: 2,
  },
  dubicars_uae_exact: {
    market: "uae",
    supported: ["sourcePrice", "photos", "fuelPowertrain", "engineCc", "powerHp"],
    detailRetry: ["sourcePrice", "photos"],
    transport: "direct_fixed_id",
    minimumImages: 2,
  },
  myauto_georgia_list: {
    market: "georgia",
    supported: ["photos", "engineCc", "powerHp"],
    detailRetry: ["photos"],
    transport: "fixed_id_bridge_required",
    minimumImages: 5,
  },
  autopapa_georgia_open: {
    market: "georgia",
    supported: ["sourcePrice", "photos", "powerHp"],
    detailRetry: ["sourcePrice", "photos"],
    transport: "fixed_id_bridge_required",
    minimumImages: 5,
  },
  kcar_korea_open: {
    market: "korea",
    // K Car's `hrspow` has no independently attested unit and is intentionally
    // excluded. Re-reading it must never promote peak power to exact evidence.
    supported: ["sourcePrice", "photos", "fuelPowertrain", "engineCc"],
    detailRetry: ["sourcePrice", "photos"],
    transport: "direct_fixed_id",
    minimumImages: 5,
  },
  encar_direct: {
    market: "korea",
    // The current Encar detail contract can prove these fields and its gallery,
    // but not fresh list activity or cash price. GitHub egress also needs the
    // fixed-ID bridge before any queued item is runnable.
    supported: ["photos", "fuelPowertrain", "engineCc", "powerHp"],
    detailRetry: ["photos"],
    transport: "fixed_id_bridge_required",
    minimumImages: 5,
  },
};

export type SavedDetailSkip = { need: SavedDetailNeed | "identity"; reason: string };
export type SavedDetailCapabilityDecision = {
  needs: SavedDetailNeed[];
  actionable: SavedDetailNeed[];
  skipped: SavedDetailSkip[];
  transport: SavedDetailTransport;
  runnable: boolean;
};

function isTargetMarket(value: unknown): value is SavedDetailRecoveryMarket {
  return (SAVED_DETAIL_RECOVERY_MARKETS as readonly string[]).includes(String(value || ""));
}

function positive(value: unknown) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function photoIdentityVerified(offer: Partial<VehicleOffer>) {
  const operational = offer.operational as Record<string, unknown> | undefined;
  return operational?.photoIdentityVerified === true || operational?.galleryVerified === true;
}

function specificationNeed(offer: Partial<VehicleOffer>, field: SpecificationAuditField) {
  const state = classifySpecificationEvidence(offer, field).state;
  return state !== "exact" && state !== "not_applicable";
}

export function deriveSavedDetailNeeds(offer: Partial<VehicleOffer>, stage: SavedDetailStage = "detail"): SavedDetailNeed[] {
  const needs: SavedDetailNeed[] = [];
  const capability = SAVED_DETAIL_SOURCE_CAPABILITIES[String(offer.sourceId || "")];
  const sourceCanConfirmDetailPrice = capability?.supported.includes("sourcePrice") === true;
  if (!positive(offer.sourcePrice) || !String(offer.sourceCurrency || "").trim()
    || (stage === "listing" && sourceCanConfirmDetailPrice && !exactDetailBound(offer))) needs.push("sourcePrice");
  const minimumImages = capability?.minimumImages || 2;
  if (!Array.isArray(offer.images) || credibleCatalogImages(offer.images).length < minimumImages || !photoIdentityVerified(offer)) needs.push("photos");
  if (specificationNeed(offer, "fuelPowertrain")) needs.push("fuelPowertrain");
  if (specificationNeed(offer, "engineCc")) needs.push("engineCc");
  if (specificationNeed(offer, "powerHp")) needs.push("powerHp");
  if (specificationNeed(offer, "certifiedPower")) needs.push("certifiedPower");
  return needs;
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The source URL must itself encode the exact saved sourceOfferId. */
export function savedDetailIdentityVerified(offer: Partial<VehicleOffer>) {
  if (!isTargetMarket(offer.market) || !offer.sourceId || !offer.sourceOfferId) return false;
  if (!isAllowedCatalogSourceId(offer.market as CatalogMarket, offer.sourceId)) return false;
  const sourceUrl = String(offer.operational?.sourceUrl || "");
  if (!isAllowedCatalogSourceUrl(offer.market as CatalogMarket, offer.sourceId, sourceUrl)) return false;
  const id = String(offer.sourceOfferId).trim();
  if (!id) return false;
  try {
    const url = new URL(sourceUrl);
    const token = escaped(id);
    switch (offer.sourceId) {
      case "carswitch_uae_open": return new RegExp(`/${token}/?$`).test(url.pathname);
      case "dubicars_uae_exact": return new RegExp(`-${token}\\.html$`, "i").test(url.pathname);
      case "autopapa_georgia_open": return new RegExp(`/${token}/?$`).test(url.pathname);
      case "myauto_georgia_list": return new RegExp(`/en/pr/${token}/`, "i").test(url.pathname);
      case "kcar_korea_open": return url.searchParams.get("i_sCarCd") === id;
      case "encar_direct": return new RegExp(`/cars/detail/${token}/?$`, "i").test(url.pathname);
      default: return false;
    }
  } catch {
    return false;
  }
}

export function detailRecoveryCapability(
  offer: Partial<VehicleOffer>,
  needs: readonly SavedDetailNeed[] = deriveSavedDetailNeeds(offer),
  stage: SavedDetailStage = "detail",
): SavedDetailCapabilityDecision {
  const uniqueNeeds = [...new Set(needs)].filter((need): need is SavedDetailNeed =>
    (SAVED_DETAIL_NEEDS as readonly string[]).includes(need));
  const capability = SAVED_DETAIL_SOURCE_CAPABILITIES[String(offer.sourceId || "")];
  if (!capability || !isTargetMarket(offer.market) || capability.market !== offer.market) {
    return {
      needs: uniqueNeeds,
      actionable: [],
      skipped: uniqueNeeds.map((need) => ({ need, reason: "source_has_no_fixed_detail_contract" })),
      transport: "unsupported",
      runnable: false,
    };
  }
  if (!savedDetailIdentityVerified(offer)) {
    return {
      needs: uniqueNeeds,
      actionable: [],
      skipped: [{ need: "identity", reason: "saved_detail_identity_unverified" }],
      transport: capability.transport,
      runnable: false,
    };
  }

  const actionable: SavedDetailNeed[] = [];
  const skipped: SavedDetailSkip[] = [];
  for (const need of uniqueNeeds) {
    if (!capability.supported.includes(need)) {
      skipped.push({ need, reason: `unsupported_by_source_contract:${offer.sourceId}:${need}` });
      continue;
    }
    if (stage === "detail" && !capability.detailRetry.includes(need)) {
      skipped.push({ need, reason: `saved_detail_already_exhausted_${need}` });
      continue;
    }
    actionable.push(need);
  }
  return {
    needs: uniqueNeeds,
    actionable,
    skipped,
    transport: capability.transport,
    runnable: actionable.length > 0 && capability.transport === "direct_fixed_id",
  };
}

const MUTABLE_FIELDS: Readonly<Record<SavedDetailNeed, readonly (keyof VehicleOffer)[]>> = {
  sourcePrice: ["sourcePrice", "sourceCurrency", "priceMode"],
  photos: ["images"],
  fuelPowertrain: ["fuel", "powertrainKind"],
  engineCc: ["engineCc"],
  powerHp: ["powerHp", "powerKw", "icePowerKw", "utilizationPowerKw", "powerDataConfidence", "powerDataSource"],
  certifiedPower: ["power30MinKw", "power30MinKwByMotor", "utilizationPowerKw", "powerDataConfidence", "powerDataSource"],
};

const PROTECTED_FIELDS = [...new Set(Object.values(MUTABLE_FIELDS).flat())];
const IMMUTABLE_IDENTITY_FIELDS: readonly (keyof VehicleOffer)[] = [
  "id", "sourceId", "sourceOfferId", "market", "offerType", "make", "model", "year", "catalogKind", "auctionResult", "auctionPriceKind",
];

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactDetailBound(offer: Partial<VehicleOffer>) {
  const operational = offer.operational as Record<string, any>;
  const raw = operational?.raw && typeof operational.raw === "object" ? operational.raw as Record<string, any> : {};
  if (operational?.exactDetail === true || operational?.detailIdentityVerified === true || raw.detailIdentityVerified === true
    || raw.autoPapaDetailIdentityVerified === true) return true;
  if (offer.sourceId === "dubicars_uae_exact") return String(raw.url || "") === String(offer.operational?.sourceUrl || "");
  if (offer.sourceId === "myauto_georgia_list") return String(raw.myAutoProductCarId || "") === String(offer.sourceOfferId || "");
  return false;
}

function validateRecoveredNeed(candidate: VehicleOffer, need: SavedDetailNeed) {
  if (need === "sourcePrice") {
    if (!positive(candidate.sourcePrice) || !String(candidate.sourceCurrency || "").trim() || !exactDetailBound(candidate)) {
      throw new Error("targeted_detail_source_price_unverified");
    }
    return;
  }
  if (need === "photos") {
    const images = Array.isArray(candidate.images) ? candidate.images : [];
    const minimumImages = SAVED_DETAIL_SOURCE_CAPABILITIES[candidate.sourceId]?.minimumImages || 2;
    if (credibleCatalogImages(images).length < minimumImages || !photoIdentityVerified(candidate)
      || images.some((image) => { try { return !/^https?:$/.test(new URL(String(image?.url || "")).protocol); } catch { return true; } })) {
      throw new Error("targeted_detail_photos_unverified");
    }
    return;
  }
  const field = need as SpecificationAuditField;
  const evidence = classifySpecificationEvidence(candidate, field);
  if (evidence.state !== "exact") throw new Error(`targeted_detail_${need}_not_exact:${evidence.reason}`);
  if (!exactDetailBound(candidate)) throw new Error(`targeted_detail_${need}_identity_unverified`);
}

/**
 * Accept only the requested exact fields from a trusted fixed-ID parser. The
 * base observation stays intact on every mismatch; callers append the returned
 * clone as a new detail revision instead of editing the saved artifact.
 */
export function validateEnrichedDetail(
  base: VehicleOffer,
  candidate: VehicleOffer,
  allowedNeeds: readonly SavedDetailNeed[],
): VehicleOffer {
  const allowed = [...new Set(allowedNeeds)].filter((need): need is SavedDetailNeed =>
    (SAVED_DETAIL_NEEDS as readonly string[]).includes(need));
  if (!allowed.length) throw new Error("targeted_detail_no_allowed_needs");
  if (!savedDetailIdentityVerified(base) || !savedDetailIdentityVerified(candidate)) {
    throw new Error("targeted_detail_identity_unverified");
  }
  for (const field of IMMUTABLE_IDENTITY_FIELDS) {
    if (!same(base[field], candidate[field])) throw new Error(`targeted_detail_identity_mismatch:${String(field)}`);
  }
  if (String(base.operational?.sourceUrl || "") !== String(candidate.operational?.sourceUrl || "")) {
    throw new Error("targeted_detail_source_url_changed");
  }
  if (candidate.status !== "active") throw new Error("targeted_detail_source_not_active");

  const supported = SAVED_DETAIL_SOURCE_CAPABILITIES[base.sourceId]?.supported || [];
  for (const need of allowed) {
    if (!supported.includes(need)) throw new Error(`targeted_detail_capability_violation:${need}`);
    validateRecoveredNeed(candidate, need);
  }
  const allowedFields = new Set(allowed.flatMap((need) => MUTABLE_FIELDS[need]));
  for (const field of PROTECTED_FIELDS) {
    if (!allowedFields.has(field) && !same(base[field], candidate[field])) {
      throw new Error(`targeted_detail_disallowed_mutation:${String(field)}`);
    }
  }

  const targetedAuditFields = new Map<SpecificationAuditField, SavedDetailNeed>([
    ["fuelPowertrain", "fuelPowertrain"], ["engineCc", "engineCc"], ["powerHp", "powerHp"], ["certifiedPower", "certifiedPower"],
  ]);
  for (const field of ["year", "fuelPowertrain", "engineCc", "powerHp", "certifiedPower"] as const) {
    const target = targetedAuditFields.get(field);
    if (target && allowed.includes(target)) continue;
    const before = classifySpecificationEvidence(base, field);
    const after = classifySpecificationEvidence(candidate, field);
    if (["exact", "not_applicable"].includes(before.state) && after.state !== before.state) {
      throw new Error(`targeted_detail_exact_evidence_regression:${field}:${after.reason}`);
    }
  }

  // A targeted recovery is not a general record refresh. Reject changes to
  // every unrelated top-level field instead of silently importing them.
  const tolerated = new Set<keyof VehicleOffer>([...allowedFields, "operational", "updatedAt"]);
  for (const field of new Set([...Object.keys(base), ...Object.keys(candidate)] as (keyof VehicleOffer)[])) {
    if (tolerated.has(field) || IMMUTABLE_IDENTITY_FIELDS.includes(field)) continue;
    if (!same(base[field], candidate[field])) throw new Error(`targeted_detail_disallowed_mutation:${String(field)}`);
  }

  const output = structuredClone(base);
  for (const field of allowedFields) (output as any)[field] = structuredClone((candidate as any)[field]);
  const baseOperational = structuredClone(base.operational || {} as VehicleOffer["operational"]);
  const candidateOperational = candidate.operational as Record<string, any>;
  const nextOperational = baseOperational as Record<string, any>;
  for (const key of ["exactDetail", "detailIdentityVerified", "fieldIdentityVerified"])
    if (candidateOperational[key] !== undefined) nextOperational[key] = structuredClone(candidateOperational[key]);
  if (allowed.includes("photos")) {
    for (const key of ["photoIdentityVerified", "galleryVerified", "vehiclePhotoVerified", "galleryImageCount", "galleryRefreshedAt", "gallerySafetyMode", "galleryStoredAs"])
      if (candidateOperational[key] !== undefined) nextOperational[key] = structuredClone(candidateOperational[key]);
  }
  const evidenceKeys: Record<SavedDetailNeed, string[]> = {
    sourcePrice: [], photos: [],
    fuelPowertrain: ["fuel", "powertrainKind"], engineCc: ["engineCc"],
    powerHp: ["powerHp", "powerKw", "peakPower"],
    certifiedPower: ["power30MinKw", "power30MinKwByMotor", "certifiedPower"],
  };
  const candidateSemantic = candidateOperational.semanticEvidence;
  if (candidateSemantic && typeof candidateSemantic === "object") {
    const semantic = { ...((baseOperational as any).semanticEvidence || {}) };
    for (const key of [...new Set(allowed.flatMap((need) => evidenceKeys[need]))])
      if (candidateSemantic[key] !== undefined) semantic[key] = structuredClone(candidateSemantic[key]);
    nextOperational.semanticEvidence = semantic;
  }
  const candidateRaw = candidateOperational.raw && typeof candidateOperational.raw === "object"
    ? candidateOperational.raw as Record<string, any> : {};
  const baseRaw = (baseOperational as any).raw && typeof (baseOperational as any).raw === "object"
    ? structuredClone((baseOperational as any).raw) as Record<string, any> : {};
  const rawKeys = new Set<string>(["detailIdentityVerified", "photoIdentityVerified"]);
  if (allowed.includes("sourcePrice")) for (const key of [
    "cashPriceAuthority", "autoPapaDetailIdentityVerified", "autoPapaDetailPriceVerified",
    "autoPapaDetailPriceUsd", "autoPapaDetailPriceAuthority", "autoPapaSellerDeclaredPriceUsd",
    "autoPapaStructuredPriceUsd", "myAutoProductCarId",
  ]) rawKeys.add(key);
  if (allowed.includes("photos")) for (const key of [
    "images", "listingBoundImages", "autoPapaDetailOriginals", "myAutoProductCarId",
    "myAutoProductPhoto", "myAutoProductPhotoVersion", "myAutoProductPictureCount", "gallerySafetyMode",
  ]) rawKeys.add(key);
  for (const key of rawKeys) if (candidateRaw[key] !== undefined) baseRaw[key] = structuredClone(candidateRaw[key]);
  nextOperational.raw = baseRaw;
  output.operational = nextOperational as VehicleOffer["operational"];
  output.firstSeenAt = base.firstSeenAt;
  output.updatedAt = candidate.updatedAt || base.updatedAt;
  output.totalRub = null;
  delete output.previousTotalRub;
  delete output.priceDeltaRub;
  delete output.priceChangedAt;
  delete output.calculationSnapshot;
  delete output.modificationSelection;
  delete output.recoveryQualification;
  delete output.catalogPricingMode;
  delete output.sellerPriceRub;
  output.calculationStatus = "needs_data";
  (output.operational as any).targetedDetailRecovery = {
    version: 1,
    baseOfferId: base.id,
    recoveredNeeds: allowed,
    fixedId: true,
  };
  return output;
}
