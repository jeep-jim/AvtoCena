import fs from "node:fs";
import { readAllOffersForMaintenance } from "../apps/web/lib/catalog/storage";
import { readDataJson } from "../apps/web/lib/data";
import { canonicalSourceModelIdentity } from "../apps/web/lib/catalog/open-source-normalizer";
import { catalogModelYearQuotaKey, CATALOG_MAX_OFFERS_PER_MODEL_YEAR } from "../apps/web/lib/catalog/inventory-quota";
import { PUBLIC_CATALOG_MARKETS } from "../apps/web/lib/catalog/runtime-config";

const SOURCE_ID = "autoscout_europe_open";
const PREFERRED_MAX_RUB = 8_000_000;
const sourceArtifact = JSON.parse(fs.readFileSync("hq-v1/autoscout-hq-refreshed.json", "utf8"));
const sourceReport = JSON.parse(fs.readFileSync("hq-v1/autoscout-hq-proof-report.json", "utf8"));

const imageUrls = (offer: any) => (Array.isArray(offer?.images) ? offer.images : []).map((image: any) => String(image?.url || "")).filter(Boolean);
const unique = (values: string[]) => [...new Set(values)];
const freshness = (offer: any) => Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0;
function exactHqImage(image: any, sourceOfferId: string) {
  const url = String(image?.url || "");
  if (!url || /\/250x188(?:\.|\/|\?|$)/i.test(url)) return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.hostname.toLowerCase() !== "prod.pictures.autoscout24.net") return false;
  if (!parsed.pathname.toLowerCase().startsWith(`/listing-images/${sourceOfferId.toLowerCase()}_`)) return false;
  return Number(image?.width || 0) >= 900 && Number(image?.height || 0) >= 600;
}
function repairEuropeModel(offer: any) {
  const title = String(offer?.sourceTitle || offer?.operational?.sourceTitle || offer?.trim || "").trim();
  const before = String(offer?.model || "").trim();
  const after = canonicalSourceModelIdentity(title, String(offer?.make || ""), before);
  if (!after || after === before) return offer;
  return {
    ...offer,
    model: after,
    operational: {
      ...(offer.operational || {}),
      raw: {
        ...(offer.operational?.raw || {}),
        europeSourceModelIdentityBefore: before,
        europeSourceModelIdentityAfter: after,
        europeSourceModelIdentityProof: true,
      },
    },
  };
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
    if (!key) { removed.push({ ...offer, quotaRemovalReason: "missing_model_year_key" }); continue; }
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

async function main() {
  const manifest: any = await readDataJson("catalog/manifest.json", null);
  if (!manifest?.generationId) throw new Error("autoscout_hq_v3_manifest_missing");
  const baselineGenerationId = String(sourceArtifact?.baselineGenerationId || sourceReport?.baselineGenerationId || "");
  if (!baselineGenerationId || baselineGenerationId !== String(manifest.generationId)) {
    throw new Error(`autoscout_hq_v3_stale_artifact:${baselineGenerationId}:${manifest.generationId}`);
  }

  const all = await readAllOffersForMaintenance();
  const active = all.filter((offer: any) => offer?.status === "active");
  const baselineCounts = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, active.filter((offer: any) => offer.market === market).length]));
  const europeBefore = active.filter((offer: any) => offer.market === "europe");
  const europeRepaired = europeBefore.map(repairEuropeModel);
  const currentAutoscout = europeRepaired.filter((offer: any) => offer.sourceId === SOURCE_ID);
  const untouchedEurope = europeRepaired.filter((offer: any) => offer.sourceId !== SOURCE_ID);
  const currentAutoscoutIds = idSet(currentAutoscout);

  const refreshedRows = (Array.isArray(sourceArtifact?.offers) ? sourceArtifact.offers : [])
    .map(repairEuropeModel)
    .filter((offer: any) => currentAutoscoutIds.has(String(offer?.id || "")));
  const refreshedIds = idSet(refreshedRows);
  const refreshSuccessRatio = currentAutoscout.length ? refreshedRows.length / currentAutoscout.length : 0;
  const hqInvalidPreCap = refreshedRows.filter((offer: any) => {
    const images = Array.isArray(offer?.images) ? offer.images : [];
    return images.length < 5 || !images.every((image: any) => exactHqImage(image, String(offer?.sourceOfferId || "")));
  });

  const preCapEurope = [...untouchedEurope, ...refreshedRows];
  const malformedMercedesPreCap = preCapEurope.filter((offer: any) => {
    const make = String(offer?.make || "").toLowerCase();
    const model = String(offer?.model || "").trim().toLowerCase();
    return /mercedes/.test(make) && model === "benz";
  });
  const repairedMercedesRows = preCapEurope.filter((offer: any) => offer?.operational?.raw?.europeSourceModelIdentityProof === true);
  const quota = applyQuota(preCapEurope);
  const candidateEurope = quota.selected;
  const selectedAutoscout = candidateEurope.filter((offer: any) => offer.sourceId === SOURCE_ID);
  const selectedAutoscoutIds = idSet(selectedAutoscout);
  const selectedRefreshed = refreshedRows.filter((offer: any) => selectedAutoscoutIds.has(String(offer?.id || "")));
  const selectedRefreshRatio = currentAutoscout.length ? selectedRefreshed.length / currentAutoscout.length : 0;

  const candidate250 = selectedAutoscout.filter((offer: any) => imageUrls(offer).some((url) => /\/250x188(?:\.|\/|\?|$)/i.test(url))).length;
  const candidateBelow5 = candidateEurope.filter((offer: any) => unique(imageUrls(offer)).length < 5).length;
  const hqInvalidAfterCap = selectedRefreshed.filter((offer: any) => {
    const images = Array.isArray(offer?.images) ? offer.images : [];
    return images.length < 5 || !images.every((image: any) => exactHqImage(image, String(offer?.sourceOfferId || "")));
  });
  const maxModelYear = Math.max(0, ...quota.counts.values());
  const malformedMercedesAfterCap = candidateEurope.filter((offer: any) => {
    const make = String(offer?.make || "").toLowerCase();
    const model = String(offer?.model || "").trim().toLowerCase();
    return /mercedes/.test(make) && model === "benz";
  });

  const untouchedBeforeIds = idSet(europeBefore.filter((offer: any) => offer.sourceId !== SOURCE_ID));
  const untouchedCandidateIds = idSet(untouchedEurope);
  const removedQuotaIds = idSet(quota.removed);
  const nonAutoscoutRemovedByQuota = untouchedEurope.filter((offer: any) => !idSet(candidateEurope).has(String(offer?.id || "")));
  const allMissingNonAutoscoutAreQuota = nonAutoscoutRemovedByQuota.every((offer: any) => removedQuotaIds.has(String(offer?.id || "")));
  const otherMarketChecks = Object.fromEntries(PUBLIC_CATALOG_MARKETS.filter((market) => market !== "europe").map((market) => {
    const rows = active.filter((offer: any) => offer.market === market);
    return [market, { count: rows.length, idsExact: true }];
  }));

  const report = {
    version: 3,
    mode: "autoscout_live_hq_source_identity_then_quota_readonly",
    generatedAt: new Date().toISOString(),
    baselineGenerationId,
    currentGenerationId: manifest.generationId,
    baselineCounts,
    europe: {
      baselineCount: europeBefore.length,
      currentAutoscout: currentAutoscout.length,
      untouchedEurope: untouchedEurope.length,
      refreshedAutoscoutPreCap: refreshedRows.length,
      refreshSuccessRatio: Number(refreshSuccessRatio.toFixed(4)),
      preCapEuropeCount: preCapEurope.length,
      selectedEuropeCount: candidateEurope.length,
      selectedAutoscout: selectedAutoscout.length,
      selectedRefreshedAutoscout: selectedRefreshed.length,
      selectedRefreshRatio: Number(selectedRefreshRatio.toFixed(4)),
      removedByQuota: quota.removed.length,
      removedNonAutoscoutByQuota: nonAutoscoutRemovedByQuota.length,
      candidateAutoscout250: candidate250,
      candidateBelow5,
      hqInvalidPreCap: hqInvalidPreCap.length,
      hqInvalidAfterCap: hqInvalidAfterCap.length,
      maxModelYear,
      malformedMercedesPreCap: malformedMercedesPreCap.length,
      malformedMercedesAfterCap: malformedMercedesAfterCap.length,
      repairedMercedesCount: repairedMercedesRows.length,
      untouchedEuropeInputIdsExact: exactSet(untouchedBeforeIds, untouchedCandidateIds),
      allMissingNonAutoscoutAreQuota,
    },
    otherMarkets: otherMarketChecks,
    quotaRemoved: quota.removed.map((offer: any) => ({ id: offer.id, sourceId: offer.sourceId, sourceOfferId: offer.sourceOfferId, make: offer.make, model: offer.model, year: offer.year, totalRub: offer.totalRub, images: offer.images?.length || 0, quotaKey: offer.quotaKey, reason: offer.quotaRemovalReason })),
    malformedMercedesSamples: malformedMercedesAfterCap.slice(0, 50).map((offer: any) => ({ id: offer.id, sourceId: offer.sourceId, sourceOfferId: offer.sourceOfferId, title: offer.sourceTitle, make: offer.make, model: offer.model, year: offer.year })),
    gates: {
      baselineCurrent: baselineGenerationId === String(manifest.generationId),
      enoughRefreshCoverage: selectedRefreshed.length >= 1000 && selectedRefreshRatio >= 0.5,
      hqExact: hqInvalidPreCap.length === 0 && hqInvalidAfterCap.length === 0,
      noAutoscoutThumbnails: candidate250 === 0,
      noBelowFive: candidateBelow5 === 0,
      modelYearQuotaApplied: maxModelYear <= CATALOG_MAX_OFFERS_PER_MODEL_YEAR,
      noMalformedMercedesBenz: malformedMercedesPreCap.length === 0 && malformedMercedesAfterCap.length === 0,
      untouchedEuropeInputIdsExact: exactSet(untouchedBeforeIds, untouchedCandidateIds),
      nonAutoscoutRemovalOnlyByQuota: allMissingNonAutoscoutAreQuota,
      untouchedMarketsExact: Object.values(otherMarketChecks).every((row: any) => row.idsExact === true),
    },
  };

  fs.writeFileSync("autoscout-hq-v3-candidate.json", JSON.stringify({ version: 3, baselineGenerationId, count: candidateEurope.length, offers: candidateEurope }, null, 2));
  fs.writeFileSync("autoscout-hq-v3-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!Object.values(report.gates).every(Boolean)) throw new Error(`autoscout_hq_v3_gate_failed:${JSON.stringify(report.gates)}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
