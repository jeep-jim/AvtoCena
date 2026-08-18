import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const REPO_ROOT = path.resolve(WORKSPACE_ROOT, "../../..");
const LEGACY_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-knowledge");
const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "AvtoCena-Encyclopedia/2.0 (https://avtocena.com)";
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-wikidata-exact-identity.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-wikidata-exact-identity-2026-08-17.json");
const CHECKPOINT_FILE = path.join(WORKSPACE_ROOT, "reports/.model-wikidata-exact-identity.checkpoint.json");

function sparqlString(value, language = null) {
  const escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
  return `"${escaped}"${language ? `@${language}` : ""}`;
}

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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchSparql(query) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        body: new URLSearchParams({ query, format: "json" }),
        headers: {
          accept: "application/sparql-results+json",
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body?.results?.bindings)) throw new Error("missing SPARQL bindings");
      return body.results.bindings;
    } catch (error) {
      lastError = error;
      await sleep(attempt * 1_500);
    }
  }
  throw new Error(`Wikidata query failed: ${lastError?.message || "unknown error"}`);
}

function safeBrandTerms(brand) {
  return [brand.id, brand.canonicalName, ...(brand.aliases || []).filter((alias) => alias.safe).map((alias) => alias.value)];
}

function uniqueBrand(index, value) {
  const matches = [...new Map((index.get(normalizeTerm(value)) || []).map((brand) => [brand.id, brand])).values()];
  return matches.length === 1 ? matches[0] : null;
}

function overlapsPriorityWindow(model) {
  const from = Number(model.yearFrom) || null;
  const to = Number(model.yearTo) || (model.active ? Number.POSITIVE_INFINITY : from);
  if (!from && !to) return false;
  const japan = (model.countries || []).includes("jp");
  return japan ? to >= 2015 && from <= 2026 : to >= 2020 && from <= 2026;
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

async function loadCheckpoint() {
  try {
    const value = await readJson(CHECKPOINT_FILE);
    if (value?.schemaVersion === 1 && value?.responses && typeof value.responses === "object") return value;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { schemaVersion: 1, source: "Wikidata", responses: {} };
}

function queryFor(rows) {
  const values = rows.map((row) => `(${sparqlString(row.brandId)} ${sparqlString(row.candidateName)} ${sparqlString(row.targetLabel, "en")})`).join("\n");
  return `
SELECT DISTINCT ?brandId ?candidateName ?targetLabel ?item ?itemLabel ?instance ?instanceLabel ?start ?end WHERE {
  VALUES (?brandId ?candidateName ?targetLabel) { ${values} }
  VALUES ?acceptedClass { wd:Q3231690 wd:Q59773381 }
  ?item rdfs:label ?targetLabel;
        wdt:P31/wdt:P279* ?acceptedClass;
        wdt:P31 ?instance.
  OPTIONAL { ?item wdt:P571 ?start. }
  OPTIONAL { ?item wdt:P576 ?end. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

export async function collectWikidataModels({ verifiedAt = "2026-08-17", querySize = 100 } = {}) {
  const [workspace, legacyModels] = await Promise.all([loadWorkspace(), loadLegacyModels()]);
  const legacyById = new Map(legacyModels.map((model) => [model.id, model]));
  const brandTerms = new Map();
  for (const brand of workspace.records.brand) {
    for (const value of safeBrandTerms(brand)) {
      const key = normalizeTerm(value);
      const rows = brandTerms.get(key) || [];
      rows.push(brand);
      brandTerms.set(key, rows);
    }
  }

  const candidates = new Map();
  const unresolvedLegacyMakes = new Map();
  for (const legacy of legacyModels) {
    if (legacy.source !== "vehiclesdb" || !overlapsPriorityWindow(legacy)) continue;
    const brand = uniqueBrand(brandTerms, legacy.make);
    if (!brand) {
      unresolvedLegacyMakes.set(legacy.make, (unresolvedLegacyMakes.get(legacy.make) || 0) + 1);
      continue;
    }
    const key = `${brand.id}:${normalizeTerm(legacy.model)}`;
    if (candidates.has(key)) continue;
    const modelStartsWithBrand = normalizeTerm(legacy.model).startsWith(normalizeTerm(brand.canonicalName));
    candidates.set(key, {
      brandId: brand.id,
      brand: brand.canonicalName,
      candidateName: legacy.model,
      targetLabel: modelStartsWithBrand ? legacy.model : `${brand.canonicalName} ${legacy.model}`,
      legacyId: legacy.id,
    });
  }

  const candidateRows = [...candidates.values()].sort((left, right) => left.brandId.localeCompare(right.brandId, "en") || left.candidateName.localeCompare(right.candidateName, "en"));
  const queryBatches = Array.from({ length: Math.ceil(candidateRows.length / querySize) }, (_, index) => candidateRows.slice(index * querySize, (index + 1) * querySize));
  const checkpoint = await loadCheckpoint();
  await mkdir(path.dirname(CHECKPOINT_FILE), { recursive: true });
  for (let index = 0; index < queryBatches.length; index += 1) {
    const batch = queryBatches[index];
    const batchKey = createHash("sha256").update(JSON.stringify(batch)).digest("hex");
    if (checkpoint.responses[batchKey]) continue;
    checkpoint.responses[batchKey] = await fetchSparql(queryFor(batch));
    await writeJson(CHECKPOINT_FILE, checkpoint);
    console.error(`Wikidata ${index + 1}/${queryBatches.length}`);
  }

  const observed = new Map();
  for (const bindings of Object.values(checkpoint.responses)) {
    for (const binding of bindings) {
      const key = `${binding.brandId.value}:${normalizeTerm(binding.candidateName.value)}`;
      if (!candidates.has(key)) continue;
      const current = observed.get(key) || { ...candidates.get(key), items: new Map() };
      const qid = binding.item.value.split("/").at(-1);
      const item = current.items.get(qid) || {
        qid,
        url: `https://www.wikidata.org/wiki/${qid}`,
        label: binding.itemLabel?.value || binding.targetLabel.value,
        instanceOf: new Map(),
        inception: new Set(),
        dissolved: new Set(),
      };
      if (binding.instance?.value) item.instanceOf.set(binding.instance.value.split("/").at(-1), binding.instanceLabel?.value || binding.instance.value.split("/").at(-1));
      if (binding.start?.value) item.inception.add(binding.start.value);
      if (binding.end?.value) item.dissolved.add(binding.end.value);
      current.items.set(qid, item);
      observed.set(key, current);
    }
  }

  const existingByIdentity = new Map();
  for (const model of workspace.records.model) {
    for (const name of [model.canonicalName, ...(model.aliases || []).map((alias) => alias.value)]) {
      const key = `${model.brandId}:${normalizeTerm(name)}`;
      const rows = existingByIdentity.get(key) || [];
      rows.push(model);
      existingByIdentity.set(key, rows);
    }
  }
  const existingSourceIds = new Set(workspace.records.source.map((source) => source.id));
  const usedIds = new Set(workspace.records.model.map((model) => model.id));
  const usedSlugs = new Set(workspace.records.model.map((model) => `${model.brandId}:${model.slug}`));
  const sources = new Map();
  const models = [];
  const reportModels = [];

  for (const [key, row] of [...observed.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    const items = [...row.items.values()].map((item) => ({
      ...item,
      instanceOf: [...item.instanceOf].map(([qid, label]) => ({ qid, label })).sort((left, right) => left.qid.localeCompare(right.qid, "en")),
      inception: [...item.inception].sort(),
      dissolved: [...item.dissolved].sort(),
    })).sort((left, right) => {
      const leftSeries = left.instanceOf.some((type) => type.qid === "Q59773381") ? 0 : 1;
      const rightSeries = right.instanceOf.some((type) => type.qid === "Q59773381") ? 0 : 1;
      return leftSeries - rightSeries || left.qid.localeCompare(right.qid, "en");
    });
    const existing = [...new Map((existingByIdentity.get(key) || []).map((model) => [model.id, model])).values()];
    const legacy = legacyById.get(row.legacyId) || {};
    const hasExplicitLegacyYears = Number.isFinite(legacy.yearFrom) || Number.isFinite(legacy.yearTo);
    const windowDisposition = hasExplicitLegacyYears ? "legacy_year_range_overlaps_priority_window" : "priority_window_unverified";
    let disposition = "new_review_model";
    let modelId = null;
    if (existing.length === 1) {
      disposition = "existing_model";
      modelId = existing[0].id;
    } else if (existing.length > 1) {
      disposition = "ambiguous_existing_models";
    } else if (!hasExplicitLegacyYears) {
      disposition = "candidate_window_unverified";
    } else {
      const primaryItem = items[0];
      const sourceId = `src-wikidata-${primaryItem.qid.toLowerCase()}`;
      if (!existingSourceIds.has(sourceId) && !sources.has(sourceId)) {
        sources.set(sourceId, {
          id: sourceId,
          type: "wikidata",
          title: `Wikidata identity for ${primaryItem.label}`,
          publisher: "Wikidata",
          url: primaryItem.url,
          documentId: primaryItem.qid,
          documentDate: null,
          verifiedAt,
          market: "Global",
          language: "en",
          supportedFields: ["canonicalName"],
          confidence: "high",
          status: "active",
          license: "CC0 1.0",
          notes: "Exact English Brand + Model label matched to a Wikidata car-model or automobile-model-series entity. Market window and model boundaries still require official regional confirmation.",
        });
      }
      const fallback = `wikidata-${primaryItem.qid.toLowerCase()}`;
      let slug = slugify(row.candidateName, fallback);
      modelId = `${row.brandId}/${slug}`;
      if (usedIds.has(modelId) || usedSlugs.has(`${row.brandId}:${slug}`)) {
        slug = `${slug}-${primaryItem.qid.toLowerCase()}`;
        modelId = `${row.brandId}/${slug}`;
      }
      usedIds.add(modelId);
      usedSlugs.add(`${row.brandId}:${slug}`);
      models.push({
        id: modelId,
        brandId: row.brandId,
        canonicalName: row.candidateName,
        slug,
        aliases: [],
        sourceNames: [{
          value: row.targetLabel,
          kind: "source_spelling",
          safe: false,
          language: "en",
          market: "Global",
          sourceIds: [sourceId],
        }],
        productionFrom: null,
        productionTo: null,
        bodyTypes: [],
        powertrainKinds: [],
        mediaIds: [],
        status: "review",
        evidence: [{
          sourceId,
          fields: ["canonicalName"],
          status: "verified",
          confidence: "high",
          note: `Exact English label ${row.targetLabel} is typed as a car model or automobile model series in Wikidata and intersects the VehiclesDB candidate ${row.brand} ${row.candidateName}.`,
        }],
        researchNotes: [
          `Wikidata candidates: ${items.map((item) => item.qid).join(", ")}.`,
          "Review status: exact marketed-model boundary, official regional years, body style, powertrain and canonical cover remain unverified; excluded from safe automatic resolution.",
        ],
        updatedAt: verifiedAt,
      });
    }
    reportModels.push({
      ...row,
      legacyYearFrom: legacy.yearFrom ?? null,
      legacyYearTo: legacy.yearTo ?? null,
      legacyActive: Boolean(legacy.active),
      windowDisposition,
      items,
      disposition,
      modelId,
      existingModelIds: existing.map((model) => model.id).sort(),
    });
  }

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    source: {
      name: "Wikidata",
      endpoint: ENDPOINT,
      classes: [{ qid: "Q3231690", label: "car model" }, { qid: "Q59773381", label: "automobile model series" }],
      license: "CC0 1.0",
    },
    window: { japan: { yearFrom: 2015, yearTo: 2026 }, otherActiveMarkets: { yearFrom: 2020, yearTo: 2026 } },
    policy: {
      exactEnglishBrandModelLabelRequired: true,
      legacyIsCandidateEvidenceOnly: true,
      importedStatus: "review",
      safeAutomaticResolution: false,
      productionYearsInferred: false,
      completionClaimAllowed: false,
    },
    totals: {
      stagedBrands: workspace.records.brand.length,
      legacyCandidatesQueried: candidateRows.length,
      exactWikidataModelIdentities: reportModels.length,
      exactWindowEligibleIdentities: reportModels.filter((model) => model.windowDisposition === "legacy_year_range_overlaps_priority_window").length,
      exactWindowUnverifiedIdentities: reportModels.filter((model) => model.windowDisposition === "priority_window_unverified").length,
      brandsWithExactIdentities: new Set(reportModels.map((model) => model.brandId)).size,
      existingModelMatches: reportModels.filter((model) => model.disposition === "existing_model").length,
      newReviewModels: models.length,
      ambiguousExistingModels: reportModels.filter((model) => model.disposition === "ambiguous_existing_models").length,
      unresolvedLegacyMakes: unresolvedLegacyMakes.size,
      exactQueries: queryBatches.length,
      sources: sources.size,
    },
    byBrand: workspace.records.brand.map((brand) => ({
      brandId: brand.id,
      brand: brand.canonicalName,
      exactIdentities: reportModels.filter((model) => model.brandId === brand.id).length,
      newReviewModels: models.filter((model) => model.brandId === brand.id).length,
    })),
    models: reportModels,
    unresolvedLegacyMakes: [...unresolvedLegacyMakes].map(([make, count]) => ({ make, candidates: count })).sort((left, right) => right.candidates - left.candidates || left.make.localeCompare(right.make, "en")),
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
  const { report, ingestion } = await collectWikidataModels();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  await unlink(CHECKPOINT_FILE).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  console.log(JSON.stringify({ reportFile: REPORT_FILE, ingestFile: INGEST_FILE, totals: report.totals }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
