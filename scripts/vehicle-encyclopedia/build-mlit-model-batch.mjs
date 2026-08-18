import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const REPO_ROOT = path.resolve(WORKSPACE_ROOT, "../../..");
const LEGACY_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-knowledge");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-mlit-canonical-intersection.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-mlit-canonical-intersection-2026-08-17.json");

function slugify(value, fallback) {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return slug || fallback;
}

function chunk(entityType, records) {
  return Array.from({ length: Math.ceil(records.length / 250) }, (_, index) => ({
    schemaVersion: 2,
    entityType,
    chunk: index + 1,
    maxRecords: 250,
    records: records.slice(index * 250, (index + 1) * 250),
  }));
}

function sourceId(url) {
  return `src-mlit-passenger-${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

function safeBrandTerms(brand) {
  return [brand.id, brand.canonicalName, ...(brand.aliases || []).filter((alias) => alias.safe).map((alias) => alias.value)];
}

function uniqueBrand(index, value) {
  const matches = [...new Map((index.get(normalizeTerm(value)) || []).map((brand) => [brand.id, brand])).values()];
  return matches.length === 1 ? matches[0] : null;
}

async function loadLegacyModels() {
  const files = (await readdir(LEGACY_ROOT)).filter((file) => /^models-[0-9].*\.json$/.test(file)).sort();
  const rows = [];
  for (const file of files) {
    const value = JSON.parse(await readFile(path.join(LEGACY_ROOT, file), "utf8"));
    if (Array.isArray(value)) rows.push(...value);
  }
  return rows;
}

export async function buildMlitModelBatch({ verifiedAt = "2026-08-17" } = {}) {
  const [workspace, mlit, legacyModels] = await Promise.all([
    loadWorkspace(),
    readJson(path.join(WORKSPACE_ROOT, "reports/model-mlit-japan-2015-2026.json")),
    loadLegacyModels(),
  ]);

  const brandTerms = new Map();
  for (const brand of workspace.records.brand) {
    for (const value of safeBrandTerms(brand)) {
      const key = normalizeTerm(value);
      const rows = brandTerms.get(key) || [];
      rows.push(brand);
      brandTerms.set(key, rows);
    }
  }

  const legacyByIdentity = new Map();
  for (const model of legacyModels) {
    const brand = uniqueBrand(brandTerms, model.make);
    if (!brand || model.source !== "vehiclesdb") continue;
    const key = `${brand.id}:${normalizeTerm(model.model)}`;
    const rows = legacyByIdentity.get(key) || [];
    rows.push(model);
    legacyByIdentity.set(key, rows);
  }

  const existingByIdentity = new Map();
  for (const model of workspace.records.model) {
    for (const name of [model.canonicalName, ...(model.aliases || []).map((alias) => alias.value), ...(model.sourceNames || []).map((alias) => alias.value)]) {
      const key = `${model.brandId}:${normalizeTerm(name)}`;
      const rows = existingByIdentity.get(key) || [];
      rows.push(model);
      existingByIdentity.set(key, rows);
    }
  }

  const usedIds = new Set(workspace.records.model.map((model) => model.id));
  const usedSlugs = new Set(workspace.records.model.map((model) => `${model.brandId}:${model.slug}`));
  const sources = new Map();
  const models = [];
  const intersections = [];
  const ambiguous = [];
  const crossBrandUnresolved = [];
  const brandPrefixes = workspace.records.brand
    .filter((brand) => /^[\x00-\x7F]{3,}$/.test(brand.canonicalName))
    .sort((left, right) => right.canonicalName.length - left.canonicalName.length);

  for (const candidate of mlit.candidates) {
    let targetBrandId = candidate.brandId;
    let namesForMatch = [...(candidate.sourceNames || [])];
    const prefixTargets = [];
    const foreignPrefixes = [];
    for (const sourceName of namesForMatch) {
      const lower = sourceName.toLowerCase();
      const prefixBrand = brandPrefixes.find((brand) => brand.id !== candidate.brandId && lower.startsWith(`${brand.canonicalName.toLowerCase()} `));
      if (!prefixBrand) continue;
      foreignPrefixes.push(prefixBrand);
      const stripped = sourceName.slice(prefixBrand.canonicalName.length).trim();
      if (legacyByIdentity.has(`${prefixBrand.id}:${normalizeTerm(stripped)}`)) prefixTargets.push({ brand: prefixBrand, prefix: prefixBrand.canonicalName });
    }
    const uniquePrefixTargets = [...new Map(prefixTargets.map((row) => [row.brand.id, row])).values()];
    if (uniquePrefixTargets.length === 1) {
      const prefixTarget = uniquePrefixTargets[0];
      targetBrandId = prefixTarget.brand.id;
      namesForMatch = namesForMatch.map((name) => name.toLowerCase().startsWith(`${prefixTarget.prefix.toLowerCase()} `) ? name.slice(prefixTarget.prefix.length).trim() : name);
    } else if (foreignPrefixes.length) {
      crossBrandUnresolved.push({
        sourceBrandId: candidate.brandId,
        possibleBrandIds: [...new Set(foreignPrefixes.map((brand) => brand.id))].sort(),
        sourceNames: candidate.sourceNames,
        reason: "source common name starts with another staged brand, but no exact target-brand legacy model boundary exists",
      });
      continue;
    }

    const matches = new Map();
    for (const sourceName of namesForMatch) {
      const key = `${targetBrandId}:${normalizeTerm(sourceName)}`;
      for (const legacy of legacyByIdentity.get(key) || []) matches.set(legacy.id, { legacy, sourceName });
    }
    if (!matches.size) continue;

    const canonicalNames = [...new Set([...matches.values()].map(({ legacy }) => legacy.model))];
    if (canonicalNames.length !== 1) {
      ambiguous.push({ brandId: targetBrandId, sourceBrandId: candidate.brandId, sourceNames: candidate.sourceNames, canonicalNames: canonicalNames.sort() });
      continue;
    }
    const canonicalName = canonicalNames[0];
    const identityKey = `${targetBrandId}:${normalizeTerm(canonicalName)}`;
    const existing = [...new Map((existingByIdentity.get(identityKey) || []).map((model) => [model.id, model])).values()];
    if (existing.length) {
      intersections.push({ brandId: targetBrandId, sourceBrandId: candidate.brandId, canonicalName, disposition: "existing_model", modelIds: existing.map((model) => model.id).sort(), sourceNames: candidate.sourceNames });
      continue;
    }

    const workbookUrl = [...(candidate.workbookUrls || [])].sort()[0];
    if (!workbookUrl) continue;
    const source = sourceId(workbookUrl);
    if (!sources.has(source)) {
      sources.set(source, {
        id: source,
        type: "government_registry",
        title: `Japan passenger-car inventory workbook ${path.basename(new URL(workbookUrl).pathname)}`,
        publisher: "Ministry of Land, Infrastructure, Transport and Tourism of Japan",
        url: workbookUrl,
        documentId: path.basename(new URL(workbookUrl).pathname),
        documentDate: null,
        verifiedAt,
        market: "Japan",
        language: "ja",
        supportedFields: ["canonicalName"],
        confidence: "official",
        status: "active",
        license: null,
        notes: "Official MLIT passenger-car inventory workbook. The exact common-name identity is retained; production range and marketed-model boundary are not inferred from inventory presence.",
      });
    }

    const fallback = `mlit-${createHash("sha256").update(identityKey).digest("hex").slice(0, 10)}`;
    let slug = slugify(canonicalName, fallback);
    let modelId = `${targetBrandId}/${slug}`;
    if (usedIds.has(modelId) || usedSlugs.has(`${targetBrandId}:${slug}`)) {
      slug = `${slug}-${createHash("sha256").update(identityKey).digest("hex").slice(0, 8)}`;
      modelId = `${targetBrandId}/${slug}`;
    }
    usedIds.add(modelId);
    usedSlugs.add(`${targetBrandId}:${slug}`);

    const sourceNames = [...new Set(candidate.sourceNames || [])]
      .filter((name) => name !== canonicalName)
      .map((name) => ({
        value: name,
        kind: "source_spelling",
        safe: normalizeTerm(name) === normalizeTerm(canonicalName),
        language: /^[\x00-\x7F]+$/.test(name) ? "en" : "ja",
        market: "Japan",
        sourceIds: [source],
      }));
    models.push({
      id: modelId,
      brandId: targetBrandId,
      canonicalName,
      slug,
      aliases: [],
      sourceNames,
      productionFrom: null,
      productionTo: null,
      bodyTypes: [],
      powertrainKinds: [],
      mediaIds: [],
      status: "review",
      evidence: [{
        sourceId: source,
        fields: ["canonicalName"],
        status: "verified",
        confidence: "official",
        note: `Exact MLIT common-name spelling intersects one VehiclesDB marketed-model candidate; MLIT manufacturer mapped from ${candidate.brand} to ${workspace.records.brand.find((brand) => brand.id === targetBrandId)?.canonicalName || targetBrandId}; observed in inventory years ${(candidate.observedInventoryYears || []).join(", ")}.`,
      }],
      researchNotes: [
        `MLIT type designation codes: ${(candidate.typeCodes || []).join(", ") || "not captured"}.`,
        "Review status: production range, body style, powertrain, cover and complete marketed-model boundary remain unverified; excluded from safe automatic resolution.",
      ],
      updatedAt: verifiedAt,
    });
    intersections.push({ brandId: targetBrandId, sourceBrandId: candidate.brandId, canonicalName, disposition: "new_review_model", modelIds: [modelId], sourceNames: candidate.sourceNames });
  }

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    policy: {
      exactNormalizedMlitToVehiclesDbIntersectionRequired: true,
      importedStatus: "review",
      safeAutomaticResolution: false,
      productionYearsInferred: false,
      completionClaimAllowed: false,
    },
    totals: {
      mlitSourceIdentities: mlit.totals.uniqueBrandModelSourceIdentities,
      exactCanonicalIntersections: intersections.length,
      existingModelIntersections: intersections.filter((row) => row.disposition === "existing_model").length,
      newReviewModels: models.length,
      brandsWithNewReviewModels: new Set(models.map((model) => model.brandId)).size,
      ambiguousIntersections: ambiguous.length,
      unresolvedCrossBrandIdentities: crossBrandUnresolved.length,
      sources: sources.size,
    },
    byBrand: workspace.records.brand.map((brand) => ({
      brandId: brand.id,
      brand: brand.canonicalName,
      newReviewModels: models.filter((model) => model.brandId === brand.id).length,
      existingModelIntersections: intersections.filter((row) => row.brandId === brand.id && row.disposition === "existing_model").length,
    })),
    intersections: intersections.sort((left, right) => left.brandId.localeCompare(right.brandId, "en") || left.canonicalName.localeCompare(right.canonicalName, "en")),
    ambiguous,
    unresolvedCrossBrandIdentities: crossBrandUnresolved,
  };
  const ingestion = {
    schemaVersion: 2,
    batches: [
      ...chunk("source", [...sources.values()].sort((left, right) => left.id.localeCompare(right.id, "en"))),
      ...chunk("model", models.sort((left, right) => left.id.localeCompare(right.id, "en"))),
    ],
  };
  return { report, ingestion };
}

async function main() {
  const { report, ingestion } = await buildMlitModelBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify({ reportFile: REPORT_FILE, ingestFile: INGEST_FILE, totals: report.totals }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
