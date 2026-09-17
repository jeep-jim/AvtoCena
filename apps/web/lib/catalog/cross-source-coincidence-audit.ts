import { createHash } from "node:crypto";
import type { VehicleOffer } from "./types";

export const CROSS_SOURCE_COINCIDENCE_POLICY_VERSION = "cross_source_coincidence_audit_v1";

type HardIdentifierKind = "vin" | "frame";
type Corroborator = "second_hard_identifier" | "production_month" | "engine_cc" | "mileage" | "shared_image_checksums";

type HardIdentifierEvidence = {
  kind: HardIdentifierKind;
  hash: string;
};

type AuditedOffer = {
  key: string;
  id: string;
  market: string;
  sourceId: string;
  sourceOfferId: string;
  identityKey: string;
  hard: Partial<Record<HardIdentifierKind, string>>;
  imageChecksums: string[];
  productionMonth: string;
  engineCc?: number;
  mileageKm?: number;
};

type PairEvidence = {
  left: AuditedOffer;
  right: AuditedOffer;
  hard: Map<HardIdentifierKind, string>;
  sharedImageChecksums: Set<string>;
  exactVehicleFacts: boolean;
};

export type CrossSourceIdentityAnomaly = {
  type: "invalid_hard_identifier" | "unattested_hard_identifier" | "offer_hard_identifier_conflict" | "source_nonunique_hard_identifier" | "source_nonunique_image_checksum";
  market: string;
  sourceId: string;
  offerIds: string[];
  identifierKind?: HardIdentifierKind;
  evidenceHash?: string;
  reason: string;
};

export type CrossSourceCoincidencePair = {
  pairId: string;
  market: string;
  sources: [string, string];
  offerIds: [string, string];
  sourceOfferIds: [string, string];
  hardIdentifiers: HardIdentifierEvidence[];
  sharedImageChecksums: string[];
  corroborators: Corroborator[];
};

export type CrossSourceSuspectedPair = CrossSourceCoincidencePair & {
  reason: "hard_identifier_without_corroboration" | "single_shared_image_checksum" | "exact_vehicle_facts_only" | "canonical_identity_missing";
};

export type CrossSourceConflict = CrossSourceCoincidencePair & {
  conflicts: string[];
};

export type CrossSourceCoincidenceAuditReport = {
  version: 1;
  auditOnly: true;
  policyVersion: typeof CROSS_SOURCE_COINCIDENCE_POLICY_VERSION;
  policyHash: string;
  inputOffers: number;
  uniqueOffers: number;
  insufficientEvidenceOffers: number;
  sourcePairs: Array<{
    market: string;
    sources: [string, string];
    candidatePairs: number;
    confirmed: number;
    suspected: number;
    conflicts: number;
  }>;
  confirmed: CrossSourceCoincidencePair[];
  suspected: CrossSourceSuspectedPair[];
  conflicts: CrossSourceConflict[];
  identityAnomalies: CrossSourceIdentityAnomaly[];
  totals: {
    confirmed: number;
    suspected: number;
    conflicts: number;
    identityAnomalies: number;
  };
};

const POLICY = {
  hardIdentifierRequiresSourceBoundExactDetail: true,
  hardIdentifierRequiresPerSourceUniqueness: true,
  imageChecksumRequiresIdentityVerifiedGallery: true,
  imageChecksumRequiresPerSourceUniqueness: true,
  minimumSharedImageChecksums: 2,
  mileageToleranceKm: 500,
  mileageToleranceRatio: 0.02,
  mutatesOffers: false,
} as const;

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function clean(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function token(value: unknown) {
  return clean(value).toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

function rawObject(offer: VehicleOffer) {
  const value = offer.operational?.raw;
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function sourceSpecificationValues(offer: VehicleOffer, pattern: RegExp) {
  const snapshot = offer.operational?.sourceSpecifications;
  if (!snapshot || snapshot.sourceId !== offer.sourceId || snapshot.sourceOfferId !== offer.sourceOfferId) return [];
  return (snapshot.groups || []).flatMap((group) => group.items || [])
    .filter((item) => pattern.test(clean(item.name)))
    .map((item) => clean(item.value))
    .filter(Boolean);
}

function sourceBoundExactIdentity(offer: VehicleOffer) {
  const operational = offer.operational as any;
  const raw = rawObject(offer);
  const snapshot = operational?.sourceSpecifications;
  const specificationBound = snapshot
    && snapshot.sourceId === offer.sourceId
    && snapshot.sourceOfferId === offer.sourceOfferId
    && (operational.detailIdentityVerified === true
      || raw.detailIdentityVerified === true
      || raw.autoPapaDetailIdentityVerified === true);
  return operational?.identityBoundExact === true
    || (operational?.detailIdentityVerified === true && operational?.fieldIdentityVerified === true)
    || (operational?.exactDetail === true && operational?.exactFields === true && raw.detailIdentityVerified === true)
    || specificationBound === true;
}

function normalizedHardIdentifier(kind: HardIdentifierKind, value: unknown) {
  const normalized = clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized) return { normalized: "", valid: false, reason: "empty" };
  if (/(?:BUYFROM|BUYWITH|UNKNOWN|NOTAVAILABLE|TESTVIN|DUMMY|SAMPLE|PLACEHOLDER|XXXXXXXX)/.test(normalized)
    || /^0+$/.test(normalized)
    || /(.)\1{7,}/.test(normalized)) {
    return { normalized, valid: false, reason: "placeholder" };
  }
  if (kind === "vin") {
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(normalized)) return { normalized, valid: false, reason: "invalid_vin_shape" };
    return { normalized, valid: true, reason: "" };
  }
  if (!/^(?=.{8,20}$)(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]+$/.test(normalized)) {
    return { normalized, valid: false, reason: "invalid_frame_shape" };
  }
  return { normalized, valid: true, reason: "" };
}

function hardIdentifierHash(kind: HardIdentifierKind, normalized: string) {
  return sha256(`${kind}:${normalized}`);
}

function hardIdentifierCandidates(offer: VehicleOffer, kind: HardIdentifierKind) {
  const operational = offer.operational as any;
  const raw = rawObject(offer);
  const direct = kind === "vin"
    ? [offer.vin, operational?.vin, raw.vehicleIdentificationNumber, raw.vin, raw.parsed?.vin]
    : [offer.frameNumber, operational?.frameNumber, raw.frameNumber, raw.frameNo, raw.chassisNumber];
  const specificationPattern = kind === "vin"
    ? /^(?:vin|vehicle identification number)$/i
    : /^(?:frame|frame number|frame no|chassis|chassis number|chassis no)$/i;
  return [...new Set([...direct, ...sourceSpecificationValues(offer, specificationPattern)].map(clean).filter(Boolean))];
}

function exactFieldNames(offer: VehicleOffer) {
  const operational = offer.operational as any;
  const raw = rawObject(offer);
  return new Set([...(operational?.sourceExactFields || []), ...(raw.sourceExactFields || [])].map(String));
}

function exactEvidence(offer: VehicleOffer, field: string) {
  const evidence = (offer.operational as any)?.semanticEvidence?.[field];
  if (clean(evidence?.status).toLowerCase() === "exact") return true;
  if (exactFieldNames(offer).has(field)) return true;
  return sourceBoundExactIdentity(offer) && ["productionDate", "mileageKm"].includes(field);
}

function exactPositiveNumber(offer: VehicleOffer, field: "engineCc" | "mileageKm") {
  const value = Number(offer[field]);
  return exactEvidence(offer, field) && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function exactProductionMonth(offer: VehicleOffer) {
  if (!exactEvidence(offer, "productionDate")) return "";
  const value = clean(offer.productionDate);
  const compact = value.match(/^(\d{4})(\d{2})/);
  if (compact && Number(compact[2]) >= 1 && Number(compact[2]) <= 12) return `${compact[1]}-${compact[2]}`;
  const separated = value.match(/^(\d{4})[-/.](\d{2})/);
  return separated && Number(separated[2]) >= 1 && Number(separated[2]) <= 12 ? `${separated[1]}-${separated[2]}` : "";
}

function verifiedImageChecksums(offer: VehicleOffer) {
  const operational = offer.operational as any;
  const raw = rawObject(offer);
  const verified = operational?.photoIdentityVerified === true
    || raw.photoIdentityVerified === true
    || (operational?.galleryVerified === true && raw.listingBoundImages === true);
  if (!verified) return [];
  return [...new Set((offer.images || []).flatMap((image) => {
    const checksum = clean(image?.checksum).toLowerCase().replace(/^sha256:/, "");
    return /^[a-f0-9]{32,128}$/.test(checksum) && Number(image?.size || 0) >= 8_000 ? [checksum] : [];
  }))].sort();
}

function offerKey(offer: VehicleOffer) {
  return [clean(offer.market), clean(offer.sourceId), clean(offer.id)].join("\u0000");
}

function revisionScore(offer: VehicleOffer) {
  const exactStatuses = Object.values((offer.operational as any)?.semanticEvidence || {})
    .filter((value: any) => clean(value?.status).toLowerCase() === "exact").length;
  return Number(sourceBoundExactIdentity(offer)) * 1_000_000
    + verifiedImageChecksums(offer).length * 10_000
    + exactStatuses * 100;
}

function uniqueLatestOffers(offers: readonly VehicleOffer[]) {
  const groups = new Map<string, VehicleOffer[]>();
  for (const offer of offers) groups.set(offerKey(offer), [...(groups.get(offerKey(offer)) || []), offer]);
  return [...groups.values()].map((rows) => [...rows].sort((left, right) => revisionScore(right) - revisionScore(left)
    || (Date.parse(String(right.updatedAt || "")) || 0) - (Date.parse(String(left.updatedAt || "")) || 0)
    || JSON.stringify(right).localeCompare(JSON.stringify(left), "en"))[0]);
}

function sourcePair(left: AuditedOffer, right: AuditedOffer): [string, string] {
  return [left.sourceId, right.sourceId].sort((a, b) => a.localeCompare(b, "en")) as [string, string];
}

function orderedPair(left: AuditedOffer, right: AuditedOffer): [AuditedOffer, AuditedOffer] {
  return left.key.localeCompare(right.key, "en") <= 0 ? [left, right] : [right, left];
}

function pairKey(left: AuditedOffer, right: AuditedOffer) {
  const [first, second] = orderedPair(left, right);
  return `${first.key}\u0001${second.key}`;
}

function publicPair(evidence: PairEvidence, corroborators: Corroborator[]): CrossSourceCoincidencePair {
  const [left, right] = orderedPair(evidence.left, evidence.right);
  const hardIdentifiers = [...evidence.hard.entries()]
    .map(([kind, hash]) => ({ kind, hash }))
    .sort((a, b) => a.kind.localeCompare(b.kind, "en"));
  return {
    pairId: sha256(pairKey(left, right)),
    market: left.market,
    sources: sourcePair(left, right),
    offerIds: [left.id, right.id],
    sourceOfferIds: [left.sourceOfferId, right.sourceOfferId],
    hardIdentifiers,
    sharedImageChecksums: [...evidence.sharedImageChecksums].sort(),
    corroborators: [...new Set(corroborators)].sort() as Corroborator[],
  };
}

function sameMileage(left?: number, right?: number) {
  if (left === undefined || right === undefined) return false;
  return Math.abs(left - right) <= Math.max(POLICY.mileageToleranceKm, Math.min(left, right) * POLICY.mileageToleranceRatio);
}

function pairCorroborators(evidence: PairEvidence) {
  const { left, right } = evidence;
  const corroborators: Corroborator[] = [];
  if (evidence.hard.size >= 2) corroborators.push("second_hard_identifier");
  if (left.productionMonth && left.productionMonth === right.productionMonth) corroborators.push("production_month");
  if (left.engineCc !== undefined && left.engineCc === right.engineCc) corroborators.push("engine_cc");
  if (sameMileage(left.mileageKm, right.mileageKm)) corroborators.push("mileage");
  if (evidence.sharedImageChecksums.size >= POLICY.minimumSharedImageChecksums) corroborators.push("shared_image_checksums");
  return corroborators;
}

function pairConflicts(evidence: PairEvidence) {
  const { left, right } = evidence;
  const conflicts: string[] = [];
  if (left.identityKey && right.identityKey && left.identityKey !== right.identityKey) conflicts.push("canonical_identity_mismatch");
  for (const kind of ["vin", "frame"] as const) {
    if (left.hard[kind] && right.hard[kind] && left.hard[kind] !== right.hard[kind]) conflicts.push(`${kind}_mismatch`);
  }
  if (left.productionMonth && right.productionMonth && left.productionMonth !== right.productionMonth) conflicts.push("production_month_mismatch");
  if (left.engineCc !== undefined && right.engineCc !== undefined && left.engineCc !== right.engineCc) conflicts.push("engine_cc_mismatch");
  return conflicts.sort();
}

function sortAnomalies(rows: CrossSourceIdentityAnomaly[]) {
  return rows.sort((left, right) => [left.market, left.sourceId, left.type, left.identifierKind || "", left.evidenceHash || "", left.offerIds.join("|")].join("\u0000")
    .localeCompare([right.market, right.sourceId, right.type, right.identifierKind || "", right.evidenceHash || "", right.offerIds.join("|")].join("\u0000"), "en"));
}

/**
 * Produces evidence-only cross-source coincidence findings. It never mutates,
 * merges, removes, ranks, holds or otherwise selects offers for publication.
 */
export function auditCrossSourceVehicleCoincidences(input: readonly VehicleOffer[]): CrossSourceCoincidenceAuditReport {
  const anomalies: CrossSourceIdentityAnomaly[] = [];
  const offers = uniqueLatestOffers(input).sort((left, right) => offerKey(left).localeCompare(offerKey(right), "en"));
  const records: AuditedOffer[] = offers.map((offer) => {
    const exactIdentity = sourceBoundExactIdentity(offer);
    const hard: Partial<Record<HardIdentifierKind, string>> = {};
    for (const kind of ["vin", "frame"] as const) {
      const candidates = hardIdentifierCandidates(offer, kind);
      if (candidates.length && !exactIdentity) {
        anomalies.push({ type: "unattested_hard_identifier", market: offer.market, sourceId: offer.sourceId, offerIds: [offer.id], identifierKind: kind,
          evidenceHash: hardIdentifierHash(kind, normalizedHardIdentifier(kind, candidates[0]).normalized), reason: "hard identifier is not bound to an exact source detail" });
        continue;
      }
      const normalized = candidates.map((value) => normalizedHardIdentifier(kind, value));
      for (const invalid of normalized.filter((value) => !value.valid && value.normalized)) {
        anomalies.push({ type: "invalid_hard_identifier", market: offer.market, sourceId: offer.sourceId, offerIds: [offer.id], identifierKind: kind,
          evidenceHash: hardIdentifierHash(kind, invalid.normalized), reason: invalid.reason });
      }
      const valid = [...new Set(normalized.filter((value) => value.valid).map((value) => value.normalized))];
      if (valid.length > 1) {
        anomalies.push({ type: "offer_hard_identifier_conflict", market: offer.market, sourceId: offer.sourceId, offerIds: [offer.id], identifierKind: kind,
          evidenceHash: sha256(valid.map((value) => hardIdentifierHash(kind, value)).sort().join("|")), reason: "one offer carries multiple exact hard identifiers" });
      } else if (valid.length === 1) hard[kind] = hardIdentifierHash(kind, valid[0]);
    }
    const make = token(offer.make);
    const model = token(offer.model);
    const year = Number(offer.year);
    return {
      key: offerKey(offer),
      id: clean(offer.id),
      market: clean(offer.market),
      sourceId: clean(offer.sourceId),
      sourceOfferId: clean(offer.sourceOfferId),
      identityKey: make && model && Number.isInteger(year) && year > 0 ? `${make}|${model}|${year}` : "",
      hard,
      imageChecksums: verifiedImageChecksums(offer),
      productionMonth: exactProductionMonth(offer),
      engineCc: exactPositiveNumber(offer, "engineCc"),
      mileageKm: exactPositiveNumber(offer, "mileageKm"),
    };
  });

  const disabledHard = new Set<string>();
  const hardBySource = new Map<string, AuditedOffer[]>();
  for (const record of records) for (const kind of ["vin", "frame"] as const) {
    const hash = record.hard[kind];
    if (!hash) continue;
    const key = [record.market, record.sourceId, kind, hash].join("\u0000");
    hardBySource.set(key, [...(hardBySource.get(key) || []), record]);
  }
  for (const [key, rows] of hardBySource) {
    const distinct = [...new Map(rows.map((row) => [row.id, row])).values()];
    if (distinct.length <= 1) continue;
    const [, sourceId, kind, hash] = key.split("\u0000") as [string, string, HardIdentifierKind, string];
    for (const row of distinct) disabledHard.add(`${row.key}\u0000${kind}`);
    anomalies.push({ type: "source_nonunique_hard_identifier", market: distinct[0].market, sourceId, offerIds: distinct.map((row) => row.id).sort(),
      identifierKind: kind, evidenceHash: hash, reason: "hard identifier is reused by multiple offers in one source" });
  }

  const disabledImages = new Set<string>();
  const imageBySource = new Map<string, AuditedOffer[]>();
  for (const record of records) for (const checksum of record.imageChecksums) {
    const key = [record.market, record.sourceId, checksum].join("\u0000");
    imageBySource.set(key, [...(imageBySource.get(key) || []), record]);
  }
  for (const [key, rows] of imageBySource) {
    const distinct = [...new Map(rows.map((row) => [row.id, row])).values()];
    if (distinct.length <= 1) continue;
    const [, sourceId, checksum] = key.split("\u0000");
    for (const row of distinct) disabledImages.add(`${row.key}\u0000${checksum}`);
    anomalies.push({ type: "source_nonunique_image_checksum", market: distinct[0].market, sourceId, offerIds: distinct.map((row) => row.id).sort(),
      evidenceHash: `sha256:${checksum}`, reason: "image checksum is reused by multiple offers in one source" });
  }

  const pairs = new Map<string, PairEvidence>();
  const addPair = (left: AuditedOffer, right: AuditedOffer) => {
    if (left.market !== right.market || left.sourceId === right.sourceId || left.id === right.id) return null;
    const key = pairKey(left, right);
    let value = pairs.get(key);
    if (!value) {
      const [first, second] = orderedPair(left, right);
      value = { left: first, right: second, hard: new Map(), sharedImageChecksums: new Set(), exactVehicleFacts: false };
      pairs.set(key, value);
    }
    return value;
  };

  const hardAcrossSources = new Map<string, AuditedOffer[]>();
  for (const record of records) for (const kind of ["vin", "frame"] as const) {
    const hash = record.hard[kind];
    if (!hash || disabledHard.has(`${record.key}\u0000${kind}`)) continue;
    const key = [record.market, kind, hash].join("\u0000");
    hardAcrossSources.set(key, [...(hardAcrossSources.get(key) || []), record]);
  }
  for (const [key, rows] of hardAcrossSources) {
    const [, kind, hash] = key.split("\u0000") as [string, HardIdentifierKind, string];
    for (let left = 0; left < rows.length; left++) for (let right = left + 1; right < rows.length; right++) {
      const pair = addPair(rows[left], rows[right]);
      if (pair) pair.hard.set(kind, hash);
    }
  }

  const imagesAcrossSources = new Map<string, AuditedOffer[]>();
  for (const record of records) for (const checksum of record.imageChecksums) {
    if (disabledImages.has(`${record.key}\u0000${checksum}`)) continue;
    const key = [record.market, checksum].join("\u0000");
    imagesAcrossSources.set(key, [...(imagesAcrossSources.get(key) || []), record]);
  }
  for (const [key, rows] of imagesAcrossSources) {
    const [, checksum] = key.split("\u0000");
    for (let left = 0; left < rows.length; left++) for (let right = left + 1; right < rows.length; right++) {
      const pair = addPair(rows[left], rows[right]);
      if (pair) pair.sharedImageChecksums.add(checksum);
    }
  }

  const exactFacts = new Map<string, AuditedOffer[]>();
  for (const record of records) {
    if (!record.identityKey || record.mileageKm === undefined || record.engineCc === undefined) continue;
    const key = [record.market, record.identityKey, record.mileageKm, record.engineCc].join("\u0000");
    exactFacts.set(key, [...(exactFacts.get(key) || []), record]);
  }
  for (const rows of exactFacts.values()) for (let left = 0; left < rows.length; left++) for (let right = left + 1; right < rows.length; right++) {
    const pair = addPair(rows[left], rows[right]);
    if (pair) pair.exactVehicleFacts = true;
  }

  const confirmed: CrossSourceCoincidencePair[] = [];
  const suspected: CrossSourceSuspectedPair[] = [];
  const conflicts: CrossSourceConflict[] = [];
  const sourcePairCounts = new Map<string, { market: string; sources: [string, string]; candidatePairs: number; confirmed: number; suspected: number; conflicts: number }>();
  const sortedPairs = [...pairs.values()].sort((left, right) => pairKey(left.left, left.right).localeCompare(pairKey(right.left, right.right), "en"));
  for (const evidence of sortedPairs) {
    const corroborators = pairCorroborators(evidence);
    const conflictReasons = pairConflicts(evidence);
    const base = publicPair(evidence, corroborators);
    const identityPresent = Boolean(evidence.left.identityKey && evidence.right.identityKey);
    const identityMatches = identityPresent && evidence.left.identityKey === evidence.right.identityKey;
    const hardConfirmed = evidence.hard.size > 0 && identityMatches && corroborators.length > 0;
    const imageConfirmed = evidence.hard.size === 0
      && evidence.sharedImageChecksums.size >= POLICY.minimumSharedImageChecksums
      && identityMatches
      && corroborators.includes("mileage")
      && (corroborators.includes("engine_cc") || corroborators.includes("production_month"));
    const pairSources = sourcePair(evidence.left, evidence.right);
    const summaryKey = [evidence.left.market, ...pairSources].join("\u0000");
    const summary = sourcePairCounts.get(summaryKey) || { market: evidence.left.market, sources: pairSources, candidatePairs: 0, confirmed: 0, suspected: 0, conflicts: 0 };
    summary.candidatePairs += 1;
    if (conflictReasons.length) {
      conflicts.push({ ...base, conflicts: conflictReasons });
      summary.conflicts += 1;
    } else if (hardConfirmed || imageConfirmed) {
      confirmed.push(base);
      summary.confirmed += 1;
    } else {
      const reason: CrossSourceSuspectedPair["reason"] = !identityPresent
        ? "canonical_identity_missing"
        : evidence.hard.size > 0
          ? "hard_identifier_without_corroboration"
          : evidence.sharedImageChecksums.size === 1
            ? "single_shared_image_checksum"
            : "exact_vehicle_facts_only";
      suspected.push({ ...base, reason });
      summary.suspected += 1;
    }
    sourcePairCounts.set(summaryKey, summary);
  }

  const sourcePairs = [...sourcePairCounts.values()].sort((left, right) => [left.market, ...left.sources].join("\u0000").localeCompare([right.market, ...right.sources].join("\u0000"), "en"));
  const insufficientEvidenceOffers = records.filter((record) => {
    const enabledHard = (["vin", "frame"] as const).some((kind) => record.hard[kind] && !disabledHard.has(`${record.key}\u0000${kind}`));
    const enabledImages = record.imageChecksums.some((checksum) => !disabledImages.has(`${record.key}\u0000${checksum}`));
    return !enabledHard && !enabledImages;
  }).length;
  const identityAnomalies = sortAnomalies(anomalies);
  return {
    version: 1,
    auditOnly: true,
    policyVersion: CROSS_SOURCE_COINCIDENCE_POLICY_VERSION,
    policyHash: sha256(JSON.stringify(POLICY)),
    inputOffers: input.length,
    uniqueOffers: records.length,
    insufficientEvidenceOffers,
    sourcePairs,
    confirmed,
    suspected,
    conflicts,
    identityAnomalies,
    totals: { confirmed: confirmed.length, suspected: suspected.length, conflicts: conflicts.length, identityAnomalies: identityAnomalies.length },
  };
}
