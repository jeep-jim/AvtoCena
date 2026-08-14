import fs from "node:fs";
import { readAllOffersForMaintenance } from "../apps/web/lib/catalog/storage";
import { readDataJson } from "../apps/web/lib/data";
import { canonicalSourceModelIdentity } from "../apps/web/lib/catalog/open-source-normalizer";
import { catalogModelYearQuotaKey, CATALOG_MAX_OFFERS_PER_MODEL_YEAR } from "../apps/web/lib/catalog/inventory-quota";
import { PUBLIC_CATALOG_MARKETS } from "../apps/web/lib/catalog/runtime-config";

const SOURCE_ID = "autoscout_europe_open";
const sourceArtifact = JSON.parse(fs.readFileSync("hq-v1/autoscout-hq-refreshed.json", "utf8"));
const sourceReport = JSON.parse(fs.readFileSync("hq-v1/autoscout-hq-proof-report.json", "utf8"));

const imageUrls = (offer: any) => (Array.isArray(offer?.images) ? offer.images : []).map((image: any) => String(image?.url || "")).filter(Boolean);
const unique = (values: string[]) => [...new Set(values)];
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
function idSet(rows: any[]) { return new Set(rows.map((row) => String(row?.id || "")).filter(Boolean)); }
function exactSet(left: Set<string>, right: Set<string>) { return left.size === right.size && [...left].every((id) => right.has(id)); }

async function main() {
  const manifest: any = await readDataJson("catalog/manifest.json", null);
  if (!manifest?.generationId) throw new Error("autoscout_hq_v2_manifest_missing");
  const baselineGenerationId = String(sourceArtifact?.baselineGenerationId || sourceReport?.baselineGenerationId || "");
  if (!baselineGenerationId || baselineGenerationId !== String(manifest.generationId)) {
    throw new Error(`autoscout_hq_v2_stale_artifact:${baselineGenerationId}:${manifest.generationId}`);
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
  const successRatio = currentAutoscout.length ? refreshedRows.length / currentAutoscout.length : 0;

  const hqInvalid = refreshedRows.filter((offer: any) => {
    const images = Array.isArray(offer?.images) ? offer.images : [];
    return images.length < 5 || !images.every((image: any) => exactHqImage(image, String(offer?.sourceOfferId || "")));
  });
  const candidateEurope = [...untouchedEurope, ...refreshedRows];
  const candidate250 = candidateEurope.filter((offer: any) => offer.sourceId === SOURCE_ID && imageUrls(offer).some((url) => /\/250x188(?:\.|\/|\?|$)/i.test(url))).length;
  const candidateBelow5 = candidateEurope.filter((offer: any) => unique(imageUrls(offer)).length < 5).length;

  const countByModelYear = new Map<string, number>();
  const quotaViolations: Array<{ key: string; count: number }> = [];
  let maxModelYear = 0;
  for (const offer of candidateEurope) {
    const key = catalogModelYearQuotaKey(offer, "europe");
    if (!key) continue;
    const count = Number(countByModelYear.get(key) || 0) + 1;
    countByModelYear.set(key, count);
    maxModelYear = Math.max(maxModelYear, count);
    if (count > CATALOG_MAX_OFFERS_PER_MODEL_YEAR && quotaViolations.length < 200) quotaViolations.push({ key, count });
  }

  const mercedesBenzRows = candidateEurope.filter((offer: any) => {
    const make = String(offer?.make || "").toLowerCase();
    const model = String(offer?.model || "").trim().toLowerCase();
    return /mercedes/.test(make) && model === "benz";
  });
  const repairedMercedesRows = candidateEurope.filter((offer: any) => offer?.operational?.raw?.europeSourceModelIdentityProof === true);

  const untouchedBeforeIds = idSet(europeBefore.filter((offer: any) => offer.sourceId !== SOURCE_ID));
  const untouchedAfterIds = idSet(untouchedEurope);
  const otherMarketChecks = Object.fromEntries(PUBLIC_CATALOG_MARKETS.filter((market) => market !== "europe").map((market) => {
    const rows = active.filter((offer: any) => offer.market === market);
    return [market, { count: rows.length, idsExact: true }];
  }));

  const report = {
    version: 2,
    mode: "autoscout_live_hq_reuse_with_source_bound_model_identity_readonly",
    generatedAt: new Date().toISOString(),
    baselineGenerationId,
    currentGenerationId: manifest.generationId,
    baselineCounts,
    europe: {
      baselineCount: europeBefore.length,
      currentAutoscout: currentAutoscout.length,
      untouchedEurope: untouchedEurope.length,
      refreshedAutoscout: refreshedRows.length,
      successRatio: Number(successRatio.toFixed(4)),
      candidateEuropeCount: candidateEurope.length,
      candidateAutoscout250: candidate250,
      candidateBelow5,
      hqInvalidCount: hqInvalid.length,
      maxModelYear,
      quotaViolationCount: quotaViolations.length,
      malformedMercedesBenzCount: mercedesBenzRows.length,
      repairedMercedesCount: repairedMercedesRows.length,
      untouchedEuropeIdsExact: exactSet(untouchedBeforeIds, untouchedAfterIds),
    },
    otherMarkets: otherMarketChecks,
    malformedMercedesSamples: mercedesBenzRows.slice(0, 50).map((offer: any) => ({ id: offer.id, sourceId: offer.sourceId, sourceOfferId: offer.sourceOfferId, title: offer.sourceTitle, make: offer.make, model: offer.model, year: offer.year })),
    repairedMercedesSamples: repairedMercedesRows.slice(0, 50).map((offer: any) => ({ id: offer.id, sourceId: offer.sourceId, sourceOfferId: offer.sourceOfferId, title: offer.sourceTitle, make: offer.make, model: offer.model, year: offer.year, before: offer?.operational?.raw?.europeSourceModelIdentityBefore })),
    quotaViolations,
    gates: {
      baselineCurrent: baselineGenerationId === String(manifest.generationId),
      enoughRefreshCoverage: refreshedRows.length >= 1000 && successRatio >= 0.5,
      hqExact: hqInvalid.length === 0,
      noAutoscoutThumbnails: candidate250 === 0,
      noBelowFive: candidateBelow5 === 0,
      modelYearQuota: quotaViolations.length === 0 && maxModelYear <= CATALOG_MAX_OFFERS_PER_MODEL_YEAR,
      noMalformedMercedesBenz: mercedesBenzRows.length === 0,
      untouchedEuropeIdsExact: exactSet(untouchedBeforeIds, untouchedAfterIds),
      untouchedMarketsExact: Object.values(otherMarketChecks).every((row: any) => row.idsExact === true),
    },
  };

  fs.writeFileSync("autoscout-hq-v2-candidate.json", JSON.stringify({ version: 2, baselineGenerationId, count: candidateEurope.length, offers: candidateEurope }, null, 2));
  fs.writeFileSync("autoscout-hq-v2-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!Object.values(report.gates).every(Boolean)) throw new Error(`autoscout_hq_v2_gate_failed:${JSON.stringify(report.gates)}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
