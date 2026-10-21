import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const REPO_ROOT = path.resolve(WORKSPACE_ROOT, "../../..");
const LEGACY_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-knowledge");
const IMPORT_ROOT = path.join(REPO_ROOT, "data/catalog/imports");
const OUTPUT = path.join(WORKSPACE_ROOT, "reports/model-queue.json");

function walkRawModels(value, rows, file) {
  if (Array.isArray(value)) {
    for (const item of value) walkRawModels(item, rows, file);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.rawMake === "string" && value.rawMake.trim() && typeof value.rawModel === "string" && value.rawModel.trim()) {
    rows.push({
      rawMake: value.rawMake.trim(),
      rawModel: value.rawModel.trim(),
      year: Number.isInteger(value.year) ? value.year : null,
      market: typeof value.market === "string" ? value.market : null,
      source: typeof value.source === "string" ? value.source : typeof value.sourceId === "string" ? value.sourceId : null,
      file,
    });
  }
  for (const child of Object.values(value)) walkRawModels(child, rows, file);
}

function brandAliasIndex(brands) {
  const index = new Map();
  for (const brand of brands) {
    for (const value of [brand.id, brand.canonicalName, ...(brand.aliases || []).filter((alias) => alias.safe).map((alias) => alias.value)]) {
      const key = normalizeTerm(value);
      const rows = index.get(key) || [];
      rows.push(brand);
      index.set(key, rows);
    }
  }
  return index;
}

function uniqueBrand(index, value) {
  const rows = [...new Map((index.get(normalizeTerm(value)) || []).map((brand) => [brand.id, brand])).values()];
  return rows.length === 1 ? rows[0] : null;
}

function legacyOverlapsPriorityWindow(model) {
  const from = Number(model.yearFrom) || null;
  const to = Number(model.yearTo) || (model.active ? Number.POSITIVE_INFINITY : from);
  if (!from && !to) return false;
  const japan = (model.countries || []).includes("jp");
  return japan ? to >= 2015 && from <= 2026 : to >= 2020 && from <= 2026;
}

async function loadLegacyModels() {
  const files = (await readdir(LEGACY_ROOT)).filter((file) => /^models-.*\.json$/.test(file)).sort();
  const models = [];
  for (const file of files) {
    const value = JSON.parse(await readFile(path.join(LEGACY_ROOT, file), "utf8"));
    if (Array.isArray(value)) models.push(...value);
  }
  return { files: files.length, models };
}

async function loadRawModelObservations() {
  const files = (await readdir(IMPORT_ROOT)).filter((file) => file.endsWith(".json")).sort();
  const observations = [];
  const parsedFiles = [];
  for (const file of files) {
    try {
      const value = JSON.parse(await readFile(path.join(IMPORT_ROOT, file), "utf8"));
      const before = observations.length;
      walkRawModels(value, observations, `data/catalog/imports/${file}`);
      if (observations.length > before) parsedFiles.push(`data/catalog/imports/${file}`);
    } catch {
      // Historical diagnostics are read-only inputs; invalid files are not modified.
    }
  }
  return { parsedFiles, observations };
}

async function optionalReport(file) {
  try {
    return await readJson(path.join(WORKSPACE_ROOT, "reports", file));
  } catch {
    return null;
  }
}

export async function buildModelQueue({ root = WORKSPACE_ROOT } = {}) {
  const [workspace, legacy, raw, vpic, mlit, mlitCoverage, mlitIntersection, wikidata, eea, eeaIntersection] = await Promise.all([
    loadWorkspace(root),
    loadLegacyModels(),
    loadRawModelObservations(),
    optionalReport("model-vpic-north-america-2020-2026.json"),
    optionalReport("model-mlit-japan-2015-2026.json"),
    optionalReport("model-mlit-japan-identity-coverage.json"),
    optionalReport("model-mlit-canonical-intersection.json"),
    optionalReport("model-wikidata-exact-identity.json"),
    optionalReport("model-eea-europe-2020-2025.json"),
    optionalReport("model-eea-canonical-intersection.json"),
  ]);
  const aliases = brandAliasIndex(workspace.records.brand);
  const rows = new Map(workspace.records.brand.map((brand) => [brand.id, {
    brandId: brand.id,
    brand: brand.canonicalName,
    canonicalModels: workspace.records.model.filter((model) => model.brandId === brand.id).length,
    canonicalModelsByStatus: Object.fromEntries(["verified", "seed", "review", "unresolved", "retired"].map((status) => [status, workspace.records.model.filter((model) => model.brandId === brand.id && model.status === status).length])),
    legacyCandidateModels: 0,
    legacyPriorityWindowModels: 0,
    legacyPriorityExamples: [],
    activeRawModelOccurrences: 0,
    activeRawModels: new Set(),
    activeRawYears: new Set(),
    vpicObservedModels: 0,
    vpicNewReviewModels: 0,
    mlitSourceIdentities: 0,
    mlitCollectorUnresolvedEnglishCanonical: 0,
    mlitMappedSourceNames: 0,
    mlitRejectedSourceNames: 0,
    mlitUnresolvedSourceNames: 0,
    mlitNewReviewModels: 0,
    wikidataExactIdentities: 0,
    wikidataWindowEligibleIdentities: 0,
    wikidataNewReviewModels: 0,
    eeaMatchedModels: 0,
    eeaStagedModels: workspace.records.model.filter((model) => model.brandId === brand.id && (model.evidence || []).some((evidence) => evidence.sourceId.startsWith("src-eea-co2cars-"))).length,
    eeaModificationCandidates: 0,
    eeaUnmatchedCommercialNames: 0,
  }]));

  const legacyByBrand = new Map();
  for (const model of legacy.models) {
    const brand = uniqueBrand(aliases, model.make);
    if (!brand) continue;
    const row = rows.get(brand.id);
    row.legacyCandidateModels += 1;
    if (!legacyOverlapsPriorityWindow(model)) continue;
    row.legacyPriorityWindowModels += 1;
    const candidates = legacyByBrand.get(brand.id) || [];
    candidates.push({ model: model.model, yearFrom: model.yearFrom ?? null, yearTo: model.yearTo ?? null, active: Boolean(model.active), source: model.source || null });
    legacyByBrand.set(brand.id, candidates);
  }
  for (const [brandId, candidates] of legacyByBrand) {
    rows.get(brandId).legacyPriorityExamples = candidates
      .sort((left, right) => Number(right.active) - Number(left.active) || (right.yearFrom || 0) - (left.yearFrom || 0) || left.model.localeCompare(right.model, "en"))
      .slice(0, 25);
  }

  const unresolvedRawMakes = new Map();
  for (const observation of raw.observations) {
    const brand = uniqueBrand(aliases, observation.rawMake);
    if (!brand) {
      const unresolved = unresolvedRawMakes.get(observation.rawMake) || { rawMake: observation.rawMake, occurrences: 0, rawModels: new Set(), files: new Set() };
      unresolved.occurrences += 1;
      unresolved.rawModels.add(observation.rawModel);
      unresolved.files.add(observation.file);
      unresolvedRawMakes.set(observation.rawMake, unresolved);
      continue;
    }
    const row = rows.get(brand.id);
    row.activeRawModelOccurrences += 1;
    row.activeRawModels.add(observation.rawModel);
    if (observation.year) row.activeRawYears.add(observation.year);
  }

  for (const source of vpic?.byBrand || []) {
    const row = rows.get(source.brandId);
    if (!row) continue;
    row.vpicObservedModels = source.observedModels;
    row.vpicNewReviewModels = source.newReviewModels;
  }
  for (const source of mlit?.byBrand || []) {
    const row = rows.get(source.brandId);
    if (!row) continue;
    row.mlitSourceIdentities = source.mlitModelIdentities;
    row.mlitCollectorUnresolvedEnglishCanonical = source.unresolvedEnglishCanonical;
  }
  for (const source of mlitCoverage?.byBrand || []) {
    const row = rows.get(source.brandId);
    if (!row) continue;
    row.mlitMappedSourceNames = source.mapped;
    row.mlitRejectedSourceNames = source.rejected;
    row.mlitUnresolvedSourceNames = source.unresolved + source.ambiguous;
  }
  for (const source of mlitIntersection?.byBrand || []) {
    const row = rows.get(source.brandId);
    if (row) row.mlitNewReviewModels = source.newReviewModels;
  }
  for (const source of wikidata?.byBrand || []) {
    const row = rows.get(source.brandId);
    if (!row) continue;
    row.wikidataExactIdentities = source.exactIdentities;
    row.wikidataNewReviewModels = source.newReviewModels;
  }
  for (const model of wikidata?.models || []) {
    if (model.windowDisposition === "legacy_year_range_overlaps_priority_window") rows.get(model.brandId).wikidataWindowEligibleIdentities += 1;
  }
  for (const source of eea?.byBrand || []) {
    const row = rows.get(source.brandId);
    if (!row) continue;
    row.eeaMatchedModels = source.matchedCanonicalModels || source.exactCanonicalModels || 0;
    row.eeaModificationCandidates = source.exactModificationCandidates || 0;
    row.eeaUnmatchedCommercialNames = source.unmatchedCommercialNames || 0;
  }

  const queue = [...rows.values()].map((row) => {
    const activeRawModels = [...row.activeRawModels].sort((left, right) => left.localeCompare(right, "en"));
    const activeRawYears = [...row.activeRawYears].sort((left, right) => left - right);
    const officialObserved = row.vpicObservedModels + row.mlitSourceIdentities + row.wikidataExactIdentities + row.eeaMatchedModels;
    const queueTier = row.activeRawModelOccurrences
      ? "active-listing-first"
      : officialObserved || row.legacyPriorityWindowModels >= 10
        ? "priority-window-source-pass"
        : "long-tail-source-pass";
    return {
      ...row,
      activeRawModels,
      activeRawYears,
      queueTier,
      publicationReady: false,
      nextAction: row.mlitUnresolvedSourceNames
        ? "resolve MLIT Japanese source names to official English model identities, then collect covers and generations"
        : row.vpicNewReviewModels
          ? "review vPIC marketed-model boundaries, then collect body, powertrain, cover and generations"
          : "collect an official market model inventory for the priority window",
    };
  }).sort((left, right) => {
    const tier = { "active-listing-first": 0, "priority-window-source-pass": 1, "long-tail-source-pass": 2 };
    return tier[left.queueTier] - tier[right.queueTier]
      || right.activeRawModelOccurrences - left.activeRawModelOccurrences
      || (right.vpicObservedModels + right.mlitSourceIdentities + right.wikidataExactIdentities) - (left.vpicObservedModels + left.mlitSourceIdentities + left.wikidataExactIdentities)
      || left.brand.localeCompare(right.brand, "en");
  });

  return {
    schemaVersion: 2,
    generatedAt: "2026-08-17",
    productionConnected: false,
    window: { japan: { yearFrom: 2015, yearTo: 2026 }, otherActiveMarkets: { yearFrom: 2020, yearTo: 2026 } },
    policy: {
      legacyIsCandidateEvidenceOnly: true,
      rawListingNamesAreCandidateEvidenceOnly: true,
      modelPublicationRequiresReviewedCanonicalIdentitySpecsAndCover: true,
      completionClaimAllowed: false,
    },
    totals: {
      stagedBrands: workspace.records.brand.length,
      canonicalModels: workspace.records.model.length,
      canonicalModelsByStatus: Object.fromEntries(["verified", "seed", "review", "unresolved", "retired"].map((status) => [status, workspace.records.model.filter((model) => model.status === status).length])),
      legacyFiles: legacy.files,
      legacyModels: legacy.models.length,
      legacyPriorityWindowModels: queue.reduce((sum, row) => sum + row.legacyPriorityWindowModels, 0),
      rawModelObservations: raw.observations.length,
      uniqueRawMakeModelPairs: new Set(raw.observations.map((row) => `${row.rawMake}\u0000${row.rawModel}`)).size,
      brandsWithActiveRawModels: queue.filter((row) => row.activeRawModelOccurrences).length,
      unresolvedRawMakes: unresolvedRawMakes.size,
      vpicObservedModels: vpic?.totals?.observedUniqueModels || 0,
      vpicNewReviewModels: vpic?.totals?.newReviewModels || 0,
      mlitSourceIdentities: mlit?.totals?.uniqueBrandModelSourceIdentities || 0,
      mlitCollectorUnresolvedEnglishCanonical: mlit?.totals?.unresolvedEnglishCanonical || 0,
      mlitMappedSourceNames: mlitCoverage?.totals?.mapped || 0,
      mlitRejectedSourceNames: mlitCoverage?.totals?.rejected || 0,
      mlitUnresolvedSourceNames: (mlitCoverage?.totals?.unresolved || 0) + (mlitCoverage?.totals?.ambiguous || 0),
      mlitDecisionCoveragePercent: mlitCoverage?.totals?.decisionCoveragePercent || 0,
      mlitNewReviewModels: mlitIntersection?.totals?.newReviewModels || 0,
      wikidataExactIdentities: wikidata?.totals?.exactWikidataModelIdentities || 0,
      wikidataWindowEligibleIdentities: wikidata?.totals?.exactWindowEligibleIdentities || 0,
      wikidataNewReviewModels: wikidata?.totals?.newReviewModels || 0,
      eeaMatchedModels: eea?.totals?.matchedCanonicalModels || 0,
      eeaStagedModels: eeaIntersection?.totals?.stagedModelsWithEeaEvidence || 0,
      eeaModificationCandidates: eea?.totals?.exactModificationCandidates || 0,
      eeaUnmatchedCommercialNames: eea?.totals?.unmatchedCommercialNames || 0,
      publicationReadyBrands: 0,
    },
    rawObservationFiles: raw.parsedFiles,
    unresolvedRawMakes: [...unresolvedRawMakes.values()].map((row) => ({
      rawMake: row.rawMake,
      occurrences: row.occurrences,
      rawModels: [...row.rawModels].sort((left, right) => left.localeCompare(right, "en")),
      files: [...row.files].sort(),
    })).sort((left, right) => right.occurrences - left.occurrences || left.rawMake.localeCompare(right.rawMake, "en")),
    queue,
  };
}

async function main() {
  const report = await buildModelQueue();
  await writeJson(OUTPUT, report);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
