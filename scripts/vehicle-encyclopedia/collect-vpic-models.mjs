import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const API_ROOT = "https://vpic.nhtsa.dot.gov/api/vehicles";
const VEHICLE_TYPES = ["Passenger Car", "Multipurpose Passenger Vehicle (MPV)", "Truck"];
const YEAR_FROM = 2020;
const YEAR_TO = 2026;

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": "AvtoCena-Encyclopedia-V2/1.0" }, signal: AbortSignal.timeout(45_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = await response.json();
      if (!Array.isArray(value.Results)) throw new Error("vPIC response does not contain Results");
      return value;
    } catch (error) {
      lastError = error;
      await sleep(attempt * 750);
    }
  }
  throw new Error(`Unable to retrieve ${url}: ${lastError?.message || "unknown error"}`);
}

async function runPool(jobs, concurrency, execute) {
  let cursor = 0;
  let completed = 0;
  const results = new Array(jobs.length);
  async function worker() {
    while (cursor < jobs.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await execute(jobs[index], index);
      completed += 1;
      if (completed % 50 === 0 || completed === jobs.length) console.error(`vPIC ${completed}/${jobs.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  return results;
}

async function loadCheckpoint(file) {
  try {
    const value = await readJson(file);
    if (value?.schemaVersion === 1 && value?.responses && typeof value.responses === "object") return value;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return {
    schemaVersion: 1,
    source: "NHTSA vPIC",
    window: { yearFrom: YEAR_FROM, yearTo: YEAR_TO },
    responses: {},
  };
}

function safeBrandTerms(brand) {
  return [brand.id, brand.canonicalName, ...(brand.aliases || []).filter((alias) => alias.safe).map((alias) => alias.value)];
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

function existingModelIndex(models) {
  const index = new Map();
  for (const model of models) {
    for (const value of [model.canonicalName, ...(model.aliases || []).map((alias) => alias.value), ...(model.sourceNames || []).map((alias) => alias.value)]) {
      const key = `${model.brandId}:${normalizeTerm(value)}`;
      const rows = index.get(key) || [];
      rows.push(model);
      index.set(key, rows);
    }
  }
  return index;
}

export async function collectVpicModels({ root = WORKSPACE_ROOT, verifiedAt = new Date().toISOString().slice(0, 10), concurrency = 6 } = {}) {
  const workspace = await loadWorkspace(root);
  const brandTerms = new Map();
  for (const brand of workspace.records.brand) {
    for (const value of safeBrandTerms(brand)) {
      const key = normalizeTerm(value);
      if (!key) continue;
      const rows = brandTerms.get(key) || [];
      rows.push(brand);
      brandTerms.set(key, rows);
    }
  }

  const makeRows = [];
  for (const vehicleType of VEHICLE_TYPES) {
    const url = `${API_ROOT}/GetMakesForVehicleType/${encodeURIComponent(vehicleType)}?format=json`;
    const response = await fetchJson(url);
    makeRows.push(...response.Results.map((row) => ({ ...row, requestedVehicleType: vehicleType })));
  }

  const mappedMakes = new Map();
  const unmappedMakes = new Map();
  for (const make of makeRows) {
    const matches = [...new Map((brandTerms.get(normalizeTerm(make.MakeName)) || []).map((brand) => [brand.id, brand])).values()];
    if (matches.length !== 1) {
      unmappedMakes.set(make.MakeId, { makeId: make.MakeId, makeName: make.MakeName, matchingBrandIds: matches.map((brand) => brand.id).sort() });
      continue;
    }
    const brand = matches[0];
    const key = `${brand.id}:${make.MakeId}`;
    const current = mappedMakes.get(key) || { brand, makeId: make.MakeId, makeName: make.MakeName, vehicleTypes: new Set() };
    current.vehicleTypes.add(make.VehicleTypeName || make.requestedVehicleType);
    mappedMakes.set(key, current);
  }

  const jobs = [];
  for (const mapped of mappedMakes.values()) {
    for (let year = YEAR_FROM; year <= YEAR_TO; year += 1) {
      for (const vehicleType of VEHICLE_TYPES) {
        const url = `${API_ROOT}/GetModelsForMakeIdYear/makeId/${mapped.makeId}/modelyear/${year}/vehicletype/${encodeURIComponent(vehicleType)}?format=json`;
        jobs.push({ ...mapped, year, vehicleType, url });
      }
    }
  }

  const checkpointFile = path.join(root, "reports", ".model-vpic-north-america-2020-2026.checkpoint.json");
  await mkdir(path.dirname(checkpointFile), { recursive: true });
  const checkpoint = await loadCheckpoint(checkpointFile);
  const pendingJobs = jobs.filter((job) => !checkpoint.responses[job.url]);
  let checkpointWrite = Promise.resolve();
  const persistCheckpoint = () => {
    checkpointWrite = checkpointWrite.then(() => writeJson(checkpointFile, checkpoint));
    return checkpointWrite;
  };
  console.error(`vPIC cached ${jobs.length - pendingJobs.length}/${jobs.length}; pending ${pendingJobs.length}`);
  await runPool(pendingJobs, concurrency, async (job) => {
    const response = await fetchJson(job.url);
    checkpoint.responses[job.url] = response;
    await persistCheckpoint();
    return null;
  });
  await checkpointWrite;
  const responses = jobs.map((job) => ({ job, response: checkpoint.responses[job.url] }));
  const observations = new Map();
  for (const { job, response } of responses) {
    for (const row of response.Results) {
      if (Number(row.Make_ID) !== Number(job.makeId) || !String(row.Model_Name || "").trim()) continue;
      const key = `${job.brand.id}:${normalizeTerm(row.Model_Name)}`;
      const current = observations.get(key) || {
        brand: job.brand,
        sourceMakeIds: new Set(),
        sourceMakeNames: new Set(),
        sourceModelIds: new Set(),
        sourceModelNames: new Set(),
        years: new Set(),
        vehicleTypes: new Set(),
        queries: new Map(),
      };
      current.sourceMakeIds.add(Number(row.Make_ID));
      current.sourceMakeNames.add(String(row.Make_Name));
      current.sourceModelIds.add(Number(row.Model_ID));
      current.sourceModelNames.add(String(row.Model_Name).trim());
      current.years.add(job.year);
      current.vehicleTypes.add(row.VehicleTypeName || job.vehicleType);
      current.queries.set(job.url, { url: job.url, year: job.year, vehicleType: job.vehicleType });
      observations.set(key, current);
    }
  }

  const existingIndex = existingModelIndex(workspace.records.model);
  const usedIds = new Set(workspace.records.model.map((model) => model.id));
  const usedSlugs = new Set(workspace.records.model.map((model) => `${model.brandId}:${model.slug}`));
  const existingSourceIds = new Set(workspace.records.source.map((source) => source.id));
  const newSources = new Map();
  const newModels = [];
  const reportModels = [];

  for (const [key, observation] of [...observations.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    const sourceNames = [...observation.sourceModelNames].sort((left, right) => left.localeCompare(right, "en"));
    const preferredName = sourceNames[0];
    const existing = [...new Map((existingIndex.get(key) || []).map((model) => [model.id, model])).values()];
    const queries = [...observation.queries.values()].sort((left, right) => left.year - right.year || left.vehicleType.localeCompare(right.vehicleType));
    let disposition = "new_review_model";
    let modelId = null;
    if (existing.length === 1) {
      disposition = "existing_model";
      modelId = existing[0].id;
    } else if (existing.length > 1) {
      disposition = "ambiguous_existing_models";
    } else {
      const fallback = `vpic-model-${Math.min(...observation.sourceModelIds)}`;
      let slug = slugify(preferredName, fallback);
      let candidateId = `${observation.brand.id}/${slug}`;
      if (usedIds.has(candidateId) || usedSlugs.has(`${observation.brand.id}:${slug}`)) {
        slug = `${slug}-${Math.min(...observation.sourceModelIds)}`;
        candidateId = `${observation.brand.id}/${slug}`;
      }
      usedIds.add(candidateId);
      usedSlugs.add(`${observation.brand.id}:${slug}`);
      modelId = candidateId;

      const firstQuery = queries[0];
      const typeSlug = slugify(firstQuery.vehicleType, "vehicle");
      const sourceId = `src-nhtsa-vpic-${observation.brand.id}-${firstQuery.year}-${typeSlug}`;
      if (!existingSourceIds.has(sourceId) && !newSources.has(sourceId)) {
        newSources.set(sourceId, {
          id: sourceId,
          type: "government_registry",
          title: `${observation.brand.canonicalName} model inventory, ${firstQuery.year} ${firstQuery.vehicleType}`,
          publisher: "U.S. Department of Transportation, National Highway Traffic Safety Administration",
          url: firstQuery.url,
          documentId: `vPIC Make_ID ${Math.min(...observation.sourceMakeIds)}`,
          documentDate: null,
          verifiedAt,
          market: "North America",
          language: "en",
          supportedFields: ["canonicalName"],
          confidence: "official",
          status: "active",
          license: null,
          notes: "Manufacturer-submitted vPIC model identity observed in an exact make, model-year and vehicle-type query. Global marketed-model identity still requires brand review.",
        });
      }
      newModels.push({
        id: modelId,
        brandId: observation.brand.id,
        canonicalName: preferredName,
        slug,
        aliases: [],
        sourceNames: [],
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
          confidence: "official",
          note: `Exact English model spelling reported to NHTSA; observed model years ${[...observation.years].sort().join(", ")}.`,
        }],
        researchNotes: [
          `North American vPIC observations: model years ${[...observation.years].sort().join(", ")}; vehicle types ${[...observation.vehicleTypes].sort().join(", ")}.`,
          "Review status: marketed-model boundary, actual global production range, body style, powertrain and canonical cover remain unverified; this record is excluded from safe automatic resolution.",
        ],
        updatedAt: verifiedAt,
      });
    }
    reportModels.push({
      brandId: observation.brand.id,
      brand: observation.brand.canonicalName,
      modelId,
      sourceModelNames: sourceNames,
      sourceModelIds: [...observation.sourceModelIds].sort((left, right) => left - right),
      observedModelYears: [...observation.years].sort((left, right) => left - right),
      vehicleTypes: [...observation.vehicleTypes].sort(),
      disposition,
      existingMatches: existing.map((model) => model.id).sort(),
      queries,
    });
  }

  const brandReports = workspace.records.brand.map((brand) => {
    const mapped = [...mappedMakes.values()].filter((row) => row.brand.id === brand.id);
    const models = reportModels.filter((row) => row.brandId === brand.id);
    return {
      brandId: brand.id,
      brand: brand.canonicalName,
      vpicMakeIds: mapped.map((row) => row.makeId).sort((left, right) => left - right),
      vpicMakeNames: [...new Set(mapped.map((row) => row.makeName))].sort(),
      observedModels: models.length,
      existingModels: models.filter((row) => row.disposition === "existing_model").length,
      newReviewModels: models.filter((row) => row.disposition === "new_review_model").length,
      ambiguousModels: models.filter((row) => row.disposition === "ambiguous_existing_models").length,
    };
  });

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    source: {
      name: "NHTSA vPIC",
      documentation: "https://vpic.nhtsa.dot.gov/api/Home/Index",
      authority: "U.S. Department of Transportation, National Highway Traffic Safety Administration",
      scope: "Vehicles intended for sale or importation into the United States; not a global model denominator.",
    },
    window: { market: "North America", yearFrom: YEAR_FROM, yearTo: YEAR_TO },
    policy: {
      safeResolutionStatuses: ["seed", "verified"],
      importedStatus: "review",
      productionYearsInferred: false,
      bodyTypeInferred: false,
      powertrainInferred: false,
      completionClaimAllowed: false,
    },
    totals: {
      v2Brands: workspace.records.brand.length,
      brandsMappedToVpic: new Set([...mappedMakes.values()].map((row) => row.brand.id)).size,
      brandsWithObservations: new Set(reportModels.map((row) => row.brandId)).size,
      observedUniqueModels: reportModels.length,
      existingModelMatches: reportModels.filter((row) => row.disposition === "existing_model").length,
      newReviewModels: newModels.length,
      ambiguousExistingModels: reportModels.filter((row) => row.disposition === "ambiguous_existing_models").length,
      unmappedVpicMakes: unmappedMakes.size,
      exactApiQueries: jobs.length,
    },
    byBrand: brandReports,
    models: reportModels,
    unmappedVpicMakes: [...unmappedMakes.values()].sort((left, right) => left.makeName.localeCompare(right.makeName, "en")),
  };

  return {
    report,
    ingestion: {
      schemaVersion: 2,
      batches: [
        ...chunk("source", [...newSources.values()].sort((left, right) => left.id.localeCompare(right.id, "en"))),
        ...chunk("model", newModels.sort((left, right) => left.id.localeCompare(right.id, "en"))),
      ],
    },
  };
}

async function main() {
  const verifiedAt = argument("verified-at", new Date().toISOString().slice(0, 10));
  const concurrency = Math.max(1, Math.min(12, Number(argument("concurrency", "6")) || 6));
  const { report, ingestion } = await collectVpicModels({ verifiedAt, concurrency });
  const reportsDir = path.join(WORKSPACE_ROOT, "reports");
  const ingestDir = path.join(WORKSPACE_ROOT, "ingest");
  await mkdir(reportsDir, { recursive: true });
  await mkdir(ingestDir, { recursive: true });
  const reportFile = path.join(reportsDir, "model-vpic-north-america-2020-2026.json");
  const ingestionFile = path.join(ingestDir, `models-vpic-north-america-2020-2026-${verifiedAt}.json`);
  await writeJson(reportFile, report);
  await writeJson(ingestionFile, ingestion);
  await unlink(path.join(WORKSPACE_ROOT, "reports", ".model-vpic-north-america-2020-2026.checkpoint.json")).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  console.log(JSON.stringify({ reportFile, ingestionFile, totals: report.totals }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
