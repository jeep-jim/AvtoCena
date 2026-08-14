import fs from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readAllOffersForMaintenance } from "../apps/web/lib/catalog/storage";
import { readDataJson } from "../apps/web/lib/data";
import { canonicalSourceModelIdentity } from "../apps/web/lib/catalog/open-source-normalizer";
import { catalogModelYearQuotaKey, CATALOG_MAX_OFFERS_PER_MODEL_YEAR } from "../apps/web/lib/catalog/inventory-quota";
import { PUBLIC_CATALOG_MARKETS } from "../apps/web/lib/catalog/runtime-config";

const SOURCE_ID = "autoscout_europe_open";
const SOURCE_RUN_ID = 31771157260;
const PREFERRED_MAX_RUB = 8_000_000;
const sourceArtifact = JSON.parse(fs.readFileSync("hq-v4/autoscout-hq-v4-candidate.json", "utf8"));
const sourceReport = JSON.parse(fs.readFileSync("hq-v4/autoscout-hq-v4-report.json", "utf8"));

const imageUrls = (offer: any) => (Array.isArray(offer?.images) ? offer.images : []).map((image: any) => String(image?.url || "")).filter(Boolean);
const unique = (values: string[]) => [...new Set(values)];
const freshness = (offer: any) => Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0;
const genericMercedesModel = (value: unknown) => /^(?:benz|mercedes|mercedes[-\s]?benz)$/i.test(String(value || "").trim());
const isMercedes = (value: unknown) => /mercedes|benz/i.test(String(value || ""));
function sourceBoundTitle(offer: any) {
  const raw = offer?.operational?.raw || {};
  return String(offer?.sourceTitle || raw?.originalCatalogTitle || raw?.title || raw?.name || offer?.trim || "").replace(/\s+/g, " ").trim();
}
function applyProvenModel(offer: any, corrections: any[]) {
  const before = String(offer?.model || "").trim();
  const title = sourceBoundTitle(offer);
  if (!title) return offer;
  const after = canonicalSourceModelIdentity(title, String(offer?.make || ""), before);
  if (!after || after === before) return offer;
  corrections.push({ id: offer.id, sourceId: offer.sourceId, sourceOfferId: offer.sourceOfferId, title, make: offer.make, before, after, year: offer.year });
  return { ...offer, model: after };
}
function exactHqImage(image: any, sourceOfferId: string) {
  const url = String(image?.url || "");
  if (!url || /\/250x188(?:\.|\/|\?|$)/i.test(url)) return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.hostname.toLowerCase() !== "prod.pictures.autoscout24.net") return false;
  if (!sourceOfferId) return false;
  if (!parsed.pathname.toLowerCase().startsWith(`/listing-images/${sourceOfferId.toLowerCase()}_`)) return false;
  return Number(image?.width || 0) >= 900 && Number(image?.height || 0) >= 600;
}
function quality(a: any, b: any) {
  const ap = Number(a?.totalRub || 0) > 0 && Number(a.totalRub) <= PREFERRED_MAX_RUB ? 0 : 1;
  const bp = Number(b?.totalRub || 0) > 0 && Number(b.totalRub) <= PREFERRED_MAX_RUB ? 0 : 1;
  return ap - bp
    || Number(b?.year || 0) - Number(a?.year || 0)
    || freshness(b) - freshness(a)
    || Number(b?.images?.length || 0) - Number(a?.images?.length || 0)
    || Number(a?.totalRub || Number.MAX_SAFE_INTEGER) - Number(b?.totalRub || Number.MAX_SAFE_INTEGER)
    || String(a?.id || "").localeCompare(String(b?.id || ""));
}
function applyQuota(rows: any[]) {
  const selected: any[] = [];
  const removed: any[] = [];
  const counts = new Map<string, number>();
  for (const offer of [...rows].sort(quality)) {
    const key = catalogModelYearQuotaKey(offer, "europe");
    if (!key) {
      removed.push({ ...offer, quotaRemovalReason: "missing_model_year_key" });
      continue;
    }
    const count = Number(counts.get(key) || 0);
    if (count >= CATALOG_MAX_OFFERS_PER_MODEL_YEAR) {
      removed.push({ ...offer, quotaRemovalReason: "model_year_quota", quotaKey: key });
      continue;
    }
    counts.set(key, count + 1);
    selected.push(offer);
  }
  return { selected, removed, counts };
}
function idSet(rows: any[]) { return new Set(rows.map((row) => String(row?.id || "")).filter(Boolean)); }
function exactSet(left: Set<string>, right: Set<string>) { return left.size === right.size && [...left].every((id) => right.has(id)); }
function comparable(offer: any, allowImages: boolean) {
  const clone = structuredClone(offer);
  delete clone.model;
  if (allowImages) delete clone.images;
  return JSON.stringify(clone);
}
function jsonHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main() {
  const manifestStart: any = await readDataJson("catalog/manifest.json", null);
  if (!manifestStart?.generationId) throw new Error("autoscout_hq_v4_gate_fix_manifest_missing");
  const baselineGenerationId = String(sourceArtifact?.baselineGenerationId || sourceReport?.baselineGenerationId || "");
  if (!baselineGenerationId || baselineGenerationId !== String(manifestStart.generationId)) {
    throw new Error(`autoscout_hq_v4_gate_fix_stale:${baselineGenerationId}:${manifestStart?.generationId || ""}`);
  }

  const validatorCodeHead = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const all = await readAllOffersForMaintenance();
  const active = all.filter((offer: any) => offer?.status === "active");
  const currentByMarket = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, active.filter((offer: any) => offer.market === market)]));
  const currentCounts = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, currentByMarket[market].length]));
  const marketHashes = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, jsonHash(currentByMarket[market])]));
  const baselineCountsExact = PUBLIC_CATALOG_MARKETS.every((market) => Number(sourceReport?.baselineCounts?.[market] || 0) === Number(currentCounts[market] || 0));

  const europeBefore = currentByMarket.europe;
  const currentAutoscout = europeBefore.filter((offer: any) => offer.sourceId === SOURCE_ID);
  const currentNonAutoscout = europeBefore.filter((offer: any) => offer.sourceId !== SOURCE_ID);
  const currentById = new Map(europeBefore.map((offer: any) => [String(offer.id), offer]));

  const validatorCorrections: any[] = [];
  const preCapEurope = (Array.isArray(sourceArtifact?.offers) ? sourceArtifact.offers : []).map((offer: any) => applyProvenModel(offer, validatorCorrections));
  const preCapIds = idSet(preCapEurope);
  const allPreCapIdsCurrent = [...preCapIds].every((id) => currentById.has(id));
  const preCapAutoscout = preCapEurope.filter((offer: any) => offer.sourceId === SOURCE_ID);
  const preCapNonAutoscout = preCapEurope.filter((offer: any) => offer.sourceId !== SOURCE_ID);

  const autoscoutIdentityBound = preCapAutoscout.every((offer: any) => {
    const before = currentById.get(String(offer.id));
    return before
      && before.sourceId === SOURCE_ID
      && String(before.sourceOfferId || "") === String(offer.sourceOfferId || "")
      && comparable(before, true) === comparable(offer, true);
  });
  const nonAutoscoutIdsExactPreCap = exactSet(idSet(currentNonAutoscout), idSet(preCapNonAutoscout));
  const nonAutoscoutNoUnrelatedChanges = preCapNonAutoscout.every((offer: any) => {
    const before = currentById.get(String(offer.id));
    return before && comparable(before, false) === comparable(offer, false);
  });

  const quota = applyQuota(preCapEurope);
  const candidateEurope = quota.selected;
  const candidateIds = idSet(candidateEurope);
  const selectedAutoscout = candidateEurope.filter((offer: any) => offer.sourceId === SOURCE_ID);
  const selectedNonAutoscout = candidateEurope.filter((offer: any) => offer.sourceId !== SOURCE_ID);
  const candidate250 = selectedAutoscout.filter((offer: any) => imageUrls(offer).some((url) => /\/250x188(?:\.|\/|\?|$)/i.test(url))).length;
  const candidateBelow5 = candidateEurope.filter((offer: any) => unique(imageUrls(offer)).length < 5).length;
  const invalidHq = selectedAutoscout.filter((offer: any) => {
    const images = Array.isArray(offer?.images) ? offer.images : [];
    return images.length < 5 || unique(imageUrls(offer)).length !== images.length || !images.every((image: any) => exactHqImage(image, String(offer?.sourceOfferId || "")));
  });
  const maxModelYear = Math.max(0, ...quota.counts.values());
  const quotaViolations = [...quota.counts.entries()].filter(([, count]) => count > CATALOG_MAX_OFFERS_PER_MODEL_YEAR);
  const provableMalformed = candidateEurope.filter((offer: any) => {
    if (!isMercedes(offer?.make) || !genericMercedesModel(offer?.model)) return false;
    const title = sourceBoundTitle(offer);
    const resolved = title ? canonicalSourceModelIdentity(title, String(offer?.make || ""), String(offer?.model || "")) : String(offer?.model || "");
    return resolved && !genericMercedesModel(resolved) && resolved !== String(offer?.model || "");
  });
  const unresolvedGenericMercedes = candidateEurope.filter((offer: any) => isMercedes(offer?.make) && genericMercedesModel(offer?.model));
  const badEuropeYears = candidateEurope.filter((offer: any) => Number(offer?.year || 0) < 2020);

  const removedQuotaIds = idSet(quota.removed);
  const removedNonAutoscout = preCapNonAutoscout.filter((offer: any) => !candidateIds.has(String(offer.id)));
  const nonAutoscoutRemovalOnlyByQuota = removedNonAutoscout.every((offer: any) => removedQuotaIds.has(String(offer.id)));
  const selectedNonAutoscoutNoUnrelatedChanges = selectedNonAutoscout.every((offer: any) => {
    const before = currentById.get(String(offer.id));
    return before && comparable(before, false) === comparable(offer, false);
  });

  const untouchedMarketChecks: Record<string, any> = {};
  for (const market of PUBLIC_CATALOG_MARKETS.filter((market) => market !== "europe")) {
    const v4 = sourceReport?.otherMarkets?.[market] || {};
    untouchedMarketChecks[market] = {
      count: currentByMarket[market].length,
      baselineCount: Number(sourceReport?.baselineCounts?.[market] || 0),
      countExact: currentByMarket[market].length === Number(sourceReport?.baselineCounts?.[market] || 0),
      v4IdsExact: v4.idsExact === true,
      v4JsonExact: v4.jsonExact === true,
      sha256: marketHashes[market],
    };
  }
  const untouchedMarketsExact = Object.values(untouchedMarketChecks).every((row: any) => row.countExact && row.v4IdsExact && row.v4JsonExact);

  const manifestEnd: any = await readDataJson("catalog/manifest.json", null);
  const generationStable = String(manifestEnd?.generationId || "") === baselineGenerationId;
  const gates = {
    currentGenerationMatchesV4: String(manifestStart.generationId) === baselineGenerationId,
    generationStable,
    baselineCountsExact,
    allPreCapIdsCurrent,
    enoughRefreshCoverage: preCapAutoscout.length >= 1000 && preCapAutoscout.length / Math.max(1, currentAutoscout.length) >= 0.5,
    autoscoutIdentityBound,
    noAutoscoutThumbnails: candidate250 === 0,
    exactHqGalleries: invalidHq.length === 0,
    noBelowFive: candidateBelow5 === 0,
    modelYearQuotaApplied: quotaViolations.length === 0 && maxModelYear <= CATALOG_MAX_OFFERS_PER_MODEL_YEAR,
    noProvableMalformedMercedes: provableMalformed.length === 0,
    noUnresolvedGenericMercedes: unresolvedGenericMercedes.length === 0,
    europeYears2020Plus: badEuropeYears.length === 0,
    nonAutoscoutIdsExactPreCap,
    nonAutoscoutNoUnrelatedChanges,
    nonAutoscoutRemovalOnlyByQuota,
    selectedNonAutoscoutNoUnrelatedChanges,
    untouchedMarketsExact,
  };

  const report = {
    version: 41,
    mode: "autoscout_v4_gate_fix_source_identity_then_quota_readonly",
    generatedAt: new Date().toISOString(),
    sourceV4RunId: SOURCE_RUN_ID,
    sourceV4CodeHead: sourceReport?.codeHead,
    validatorCodeHead,
    baselineGenerationId,
    endingGenerationId: String(manifestEnd?.generationId || ""),
    baselineCounts: currentCounts,
    marketHashes,
    sourceFailureSummary: {
      total: Number(sourceReport?.europe?.failedAutoscout || 0),
      http410: Array.isArray(sourceReport?.failures) ? sourceReport.failures.filter((row: any) => /http_410/i.test(String(row?.error || ""))).length : 0,
    },
    europe: {
      baselineCount: europeBefore.length,
      currentAutoscout: currentAutoscout.length,
      currentNonAutoscout: currentNonAutoscout.length,
      preCapEuropeCount: preCapEurope.length,
      preCapAutoscout: preCapAutoscout.length,
      selectedEuropeCount: candidateEurope.length,
      selectedAutoscout: selectedAutoscout.length,
      selectedNonAutoscout: selectedNonAutoscout.length,
      removedByQuota: quota.removed.length,
      removedNonAutoscoutByQuota: removedNonAutoscout.length,
      missingAutoscoutAfterLiveRefresh: currentAutoscout.length - preCapAutoscout.length,
      candidateAutoscout250: candidate250,
      candidateBelow5,
      invalidHq: invalidHq.length,
      maxModelYear,
      sourceModelCorrections: Number(sourceReport?.europe?.modelCorrections || 0),
      validatorAdditionalModelCorrections: validatorCorrections.length,
      provableMalformedMercedes: provableMalformed.length,
      unresolvedGenericMercedes: unresolvedGenericMercedes.length,
      badEuropeYears: badEuropeYears.length,
    },
    quotaRemoved: quota.removed.map((offer: any) => ({
      id: offer.id,
      sourceId: offer.sourceId,
      sourceOfferId: offer.sourceOfferId,
      make: offer.make,
      model: offer.model,
      year: offer.year,
      totalRub: offer.totalRub,
      images: Array.isArray(offer.images) ? offer.images.length : 0,
      quotaKey: offer.quotaKey,
      reason: offer.quotaRemovalReason,
    })),
    untouchedMarkets: untouchedMarketChecks,
    malformedMercedesSamples: provableMalformed.slice(0, 50).map((offer: any) => ({ id: offer.id, sourceId: offer.sourceId, sourceOfferId: offer.sourceOfferId, title: sourceBoundTitle(offer), make: offer.make, model: offer.model, year: offer.year })),
    unresolvedGenericMercedesSamples: unresolvedGenericMercedes.slice(0, 50).map((offer: any) => ({ id: offer.id, sourceId: offer.sourceId, sourceOfferId: offer.sourceOfferId, title: sourceBoundTitle(offer), make: offer.make, model: offer.model, year: offer.year })),
    badEuropeYearSamples: badEuropeYears.slice(0, 50).map((offer: any) => ({ id: offer.id, sourceId: offer.sourceId, make: offer.make, model: offer.model, year: offer.year })),
    gates,
  };

  fs.writeFileSync("autoscout-hq-v4-fixed-candidate.json", JSON.stringify({
    version: 41,
    sourceV4RunId: SOURCE_RUN_ID,
    baselineGenerationId,
    sourceV4CodeHead: sourceReport?.codeHead,
    validatorCodeHead,
    baselineCounts: currentCounts,
    marketHashes,
    count: candidateEurope.length,
    autoscoutCount: selectedAutoscout.length,
    offers: candidateEurope,
  }, null, 2));
  fs.writeFileSync("autoscout-hq-v4-fixed-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!Object.values(gates).every(Boolean)) throw new Error(`autoscout_hq_v4_gate_fix_failed:${JSON.stringify(gates)}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
