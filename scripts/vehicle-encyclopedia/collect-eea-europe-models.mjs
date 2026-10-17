import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const REPO_ROOT = path.resolve(WORKSPACE_ROOT, "../../..");
const LEGACY_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-knowledge");
const ENDPOINT = "https://discodata.eea.europa.eu/sql";
const USER_AGENT = "AvtoCena-Encyclopedia/2.0 (https://avtocena.com)";
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-eea-europe-2020-2025.json");
const REPORT_DIR = path.join(WORKSPACE_ROOT, "reports/model-eea-europe-2020-2025");
const CHECKPOINT_DIR = path.join(WORKSPACE_ROOT, "reports/.model-eea-europe-2020-2025.checkpoint");
const API_RESULT_LIMIT = 10_000;
const QUERY_CONCURRENCY = 6;

const DATASETS = [
  {
    id: "eea-co2cars-2020-2022-final",
    title: "EEA monitoring of CO2 emissions from new passenger cars, final consolidated data for 2020-2022",
    table: "[CO2Emission].[latest].[co2cars]",
    where: "[Year] BETWEEN 2020 AND 2022",
    years: [2020, 2021, 2022],
    status: "final",
    url: "https://www.eea.europa.eu/en/datahub/datahubitem-view/fa8b1229-3db6-495d-b18e-9c9b3267c02b",
  },
  {
    id: "eea-co2cars-2023-final",
    title: "EEA monitoring of CO2 emissions from new passenger cars, 2023 final data",
    table: "[CO2Emission].[latest].[co2cars_2023Fv28]",
    where: "1 = 1",
    years: [2023],
    status: "final",
    url: "https://www.eea.europa.eu/en/datahub/datahubitem-view/fa8b1229-3db6-495d-b18e-9c9b3267c02b",
  },
  {
    id: "eea-co2cars-2024-provisional",
    title: "EEA monitoring of CO2 emissions from new passenger cars, 2024 provisional data",
    table: "[CO2Emission].[latest].[co2cars_2024Pv29]",
    where: "1 = 1",
    years: [2024],
    status: "provisional",
    url: "https://www.eea.europa.eu/en/datahub/datahubitem-view/fa8b1229-3db6-495d-b18e-9c9b3267c02b",
  },
  {
    id: "eea-co2cars-2025-provisional",
    title: "EEA monitoring of CO2 emissions from new passenger cars, 2025 provisional data",
    table: "[CO2Emission].[latest].[co2cars_2025Pv31]",
    where: "1 = 1",
    years: [2025],
    status: "provisional",
    url: "https://www.eea.europa.eu/en/datahub/datahubitem-view/fa8b1229-3db6-495d-b18e-9c9b3267c02b",
  },
];

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cleanText(value) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function tokenTerm(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sortText(left, right) {
  return String(left).localeCompare(String(right), "en", { sensitivity: "base", numeric: true });
}

function safeBrandTerms(brand) {
  return [brand.id, brand.canonicalName, ...(brand.aliases || []).filter((alias) => alias.safe).map((alias) => alias.value)];
}

function uniqueBrand(index, value) {
  const matches = [...new Map((index.get(normalizeTerm(value)) || []).map((brand) => [brand.id, brand])).values()];
  return matches.length === 1 ? matches[0] : null;
}

function addToIndex(index, key, value) {
  const rows = index.get(key) || [];
  rows.push(value);
  index.set(key, rows);
}

function sourceKey(row) {
  return [row.Year, row.Mk, row.Cn, row.Ft, row.engine_cc, row.engine_kw].map((value) => value ?? "").join("\u0000");
}

function stableId(parts) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 20);
}

function dispositionRank(value) {
  return ({ existing_model: 0, legacy_exact_candidate: 1, existing_model_prefix: 2, legacy_prefix_candidate: 3 })[value] ?? 99;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function mapLimit(rows, limit, worker) {
  const results = new Array(rows.length);
  let cursor = 0;
  async function run() {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(rows[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, run));
  return results;
}

async function fetchSql(query, { page = 1, hits = 10 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const url = new URL(ENDPOINT);
      url.searchParams.set("query", query);
      url.searchParams.set("p", String(page));
      url.searchParams.set("nrOfHits", String(hits));
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body?.errors?.length) throw new Error(body.errors.map((error) => error.error).join("; "));
      if (!Array.isArray(body?.results)) throw new Error("missing results array");
      return body.results;
    } catch (error) {
      lastError = error;
      await sleep(attempt * 2_000);
    }
  }
  throw new Error(`EEA Discodata query failed: ${lastError?.message || "unknown error"}`);
}

function detailedGroupCountQuery(dataset) {
  return `SELECT COUNT(*) AS group_count FROM (SELECT [Year],Mk,Cn,T,Va,Ve,Ft,[Ec (cm3)],[Ep (KW)] FROM ${dataset.table} WHERE ${dataset.where} AND Mk IS NOT NULL AND Cn IS NOT NULL GROUP BY [Year],Mk,Cn,T,Va,Ve,Ft,[Ec (cm3)],[Ep (KW)]) AS grouped`;
}

function specificationGroupCountQuery(dataset) {
  return `SELECT COUNT(*) AS group_count FROM (SELECT [Year],Mk,Cn,Ft,[Ec (cm3)],[Ep (KW)] FROM ${dataset.table} WHERE ${dataset.where} AND Mk IS NOT NULL AND Cn IS NOT NULL GROUP BY [Year],Mk,Cn,Ft,[Ec (cm3)],[Ep (KW)]) AS grouped`;
}

function makeCommercialNameGroupCountQuery(dataset) {
  return `SELECT COUNT(*) AS group_count FROM (SELECT [Year],Mk,Cn FROM ${dataset.table} WHERE ${dataset.where} AND Mk IS NOT NULL AND Cn IS NOT NULL GROUP BY [Year],Mk,Cn) AS grouped`;
}

function makeRowsQuery(dataset) {
  return `SELECT TOP 5000 Mk, COUNT(*) AS registrations FROM ${dataset.table} WHERE ${dataset.where} AND Mk IS NOT NULL GROUP BY Mk`;
}

function specificationRowsForMakeQuery(dataset, make) {
  return `SELECT TOP ${API_RESULT_LIMIT} [Year], Mk, Cn, Ft, [Ec (cm3)] AS engine_cc, [Ep (KW)] AS engine_kw, COUNT(*) AS registrations FROM ${dataset.table} WHERE ${dataset.where} AND Mk = ${sqlString(make)} AND Cn IS NOT NULL GROUP BY [Year],Mk,Cn,Ft,[Ec (cm3)],[Ep (KW)]`;
}

async function readCheckpoint(file) {
  try {
    return await readJson(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function collectDataset(dataset, brandIndex) {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  const metadataFile = path.join(CHECKPOINT_DIR, `${dataset.id}-metadata.json`);
  let metadata = await readCheckpoint(metadataFile);
  if (!metadata?.makeRows) {
    const [detailed, specifications, makeCommercialNames, makeRows] = await Promise.all([
      fetchSql(detailedGroupCountQuery(dataset)),
      fetchSql(specificationGroupCountQuery(dataset)),
      fetchSql(makeCommercialNameGroupCountQuery(dataset)),
      fetchSql(makeRowsQuery(dataset), { hits: 5000 }),
    ]);
    metadata = {
      datasetId: dataset.id,
      detailedTypeVariantVersionGroups: Number(detailed[0]?.group_count) || 0,
      specificationGroups: Number(specifications[0]?.group_count) || 0,
      makeCommercialNameGroups: Number(makeCommercialNames[0]?.group_count) || 0,
      makeRows: makeRows.map((row) => ({ rawMake: cleanText(row.Mk), registrations: Number(row.registrations) || 0 })).filter((row) => row.rawMake),
    };
    await writeJson(metadataFile, metadata);
  }

  const mappedMakes = metadata.makeRows.filter((row) => uniqueBrand(brandIndex, row.rawMake));
  const groupedRows = await mapLimit(mappedMakes, QUERY_CONCURRENCY, async (makeRow, index) => {
    const pageFile = path.join(CHECKPOINT_DIR, `${dataset.id}-make-${stableId([makeRow.rawMake])}.json`);
    let rows = await readCheckpoint(pageFile);
    if (!rows) {
      rows = await fetchSql(specificationRowsForMakeQuery(dataset, makeRow.rawMake), { hits: API_RESULT_LIMIT });
      if (rows.length === API_RESULT_LIMIT) throw new Error(`EEA grouped result reached ${API_RESULT_LIMIT} rows for ${dataset.id} / ${makeRow.rawMake}; partition the query before accepting it`);
      await writeJson(pageFile, rows);
    }
    if ((index + 1) % 10 === 0 || index + 1 === mappedMakes.length) console.error(`EEA ${dataset.id}: ${index + 1}/${mappedMakes.length} mapped make strings`);
    return rows;
  });
  const rows = groupedRows.flat();
  return { dataset, metadata, rows };
}

async function loadLegacyModels() {
  const files = (await readdir(LEGACY_ROOT)).filter((file) => /^models-.*\.json$/.test(file)).sort();
  const rows = [];
  for (const file of files) {
    const value = JSON.parse(await readFile(path.join(LEGACY_ROOT, file), "utf8"));
    if (Array.isArray(value)) rows.push(...value);
  }
  return rows;
}

function exactModelMatch({ brand, commercialName, existingIndex, legacyIndex, prefixIndex }) {
  const names = [commercialName];
  for (const term of safeBrandTerms(brand).sort((left, right) => right.length - left.length)) {
    if (!commercialName.toLocaleLowerCase("en").startsWith(`${term.toLocaleLowerCase("en")} `)) continue;
    const stripped = commercialName.slice(term.length).trim();
    if (stripped) names.push(stripped);
  }

  for (const candidateName of names) {
    const key = `${brand.id}:${normalizeTerm(candidateName)}`;
    const existing = [...new Map((existingIndex.get(key) || []).map((model) => [model.id, model])).values()];
    if (existing.length === 1) {
      return {
        disposition: "existing_model",
        canonicalName: existing[0].canonicalName,
        modelId: existing[0].id,
        matchedSourceName: candidateName,
      };
    }
    if (existing.length > 1) return { disposition: "ambiguous_existing_models", candidates: existing.map((model) => model.id).sort() };

    const legacy = legacyIndex.get(key) || [];
    const canonicalNames = [...new Set(legacy.map((model) => cleanText(model.model)).filter(Boolean))];
    if (canonicalNames.length === 1) {
      return {
        disposition: "legacy_exact_candidate",
        canonicalName: canonicalNames[0],
        modelId: null,
        matchedSourceName: candidateName,
      };
    }
    if (canonicalNames.length > 1) return { disposition: "ambiguous_legacy_models", candidates: canonicalNames.sort(sortText) };
  }

  for (const candidateName of names) {
    const sourceTerm = tokenTerm(candidateName);
    if (!sourceTerm) continue;
    const prefixMatches = (prefixIndex.get(brand.id) || []).filter((candidate) => sourceTerm === candidate.term || sourceTerm.startsWith(`${candidate.term} `));
    if (!prefixMatches.length) continue;
    const longest = Math.max(...prefixMatches.map((candidate) => candidate.term.length));
    const longestMatches = prefixMatches.filter((candidate) => candidate.term.length === longest);
    const identities = [...new Map(longestMatches.map((candidate) => [`${normalizeTerm(candidate.canonicalName)}:${candidate.modelId || "legacy"}`, candidate])).values()];
    const canonicalNames = [...new Set(identities.map((candidate) => normalizeTerm(candidate.canonicalName)))];
    if (canonicalNames.length !== 1) return { disposition: "ambiguous_model_prefix", candidates: identities.map((candidate) => candidate.canonicalName).sort(sortText) };
    const existing = identities.find((candidate) => candidate.modelId) || null;
    const selected = existing || identities[0];
    return {
      disposition: selected.modelId ? "existing_model_prefix" : "legacy_prefix_candidate",
      canonicalName: selected.canonicalName,
      modelId: selected.modelId,
      matchedSourceName: candidateName,
      matchedPrefix: selected.term,
    };
  }
  return { disposition: "unmatched" };
}

function reportChunk(recordType, records, index) {
  return {
    schemaVersion: 1,
    recordType,
    chunk: index + 1,
    maxRecords: 250,
    records: records.slice(index * 250, (index + 1) * 250),
  };
}

async function writeReportCollection(prefix, recordType, records) {
  const files = [];
  for (let index = 0; index < Math.ceil(records.length / 250); index += 1) {
    const file = `${prefix}-${String(index + 1).padStart(4, "0")}.json`;
    await writeJson(path.join(REPORT_DIR, file), reportChunk(recordType, records, index));
    files.push(file);
  }
  return files;
}

export async function collectEeaEuropeModels({ generatedAt = "2026-08-17" } = {}) {
  const [workspace, legacyModels] = await Promise.all([loadWorkspace(), loadLegacyModels()]);

  const brandIndex = new Map();
  for (const brand of workspace.records.brand) {
    for (const term of safeBrandTerms(brand)) addToIndex(brandIndex, normalizeTerm(term), brand);
  }
  const collected = await Promise.all(DATASETS.map((dataset) => collectDataset(dataset, brandIndex)));

  const existingIndex = new Map();
  for (const model of workspace.records.model) {
    for (const name of [model.canonicalName, ...(model.aliases || []).map((alias) => alias.value), ...(model.sourceNames || []).map((alias) => alias.value)]) {
      addToIndex(existingIndex, `${model.brandId}:${normalizeTerm(name)}`, model);
    }
  }

  const legacyIndex = new Map();
  for (const model of legacyModels) {
    if (model.source !== "vehiclesdb") continue;
    const brand = uniqueBrand(brandIndex, model.make);
    if (!brand) continue;
    addToIndex(legacyIndex, `${brand.id}:${normalizeTerm(model.model)}`, model);
  }

  const prefixCandidates = new Map();
  const addPrefixCandidate = (brandId, canonicalName, modelId, names) => {
    const candidates = prefixCandidates.get(brandId) || new Map();
    for (const name of names) {
      const term = tokenTerm(name);
      if (term.length < 2) continue;
      const key = `${normalizeTerm(canonicalName)}:${term}`;
      const current = candidates.get(key);
      if (!current || (!current.modelId && modelId)) candidates.set(key, { canonicalName, modelId, term });
    }
    prefixCandidates.set(brandId, candidates);
  };
  for (const model of workspace.records.model) {
    addPrefixCandidate(model.brandId, model.canonicalName, model.id, [model.canonicalName, ...(model.aliases || []).map((alias) => alias.value), ...(model.sourceNames || []).map((alias) => alias.value)]);
  }
  for (const model of legacyModels) {
    if (model.source !== "vehiclesdb") continue;
    const brand = uniqueBrand(brandIndex, model.make);
    if (brand) addPrefixCandidate(brand.id, model.model, null, [model.model]);
  }
  const prefixIndex = new Map([...prefixCandidates].map(([brandId, candidates]) => [brandId, [...candidates.values()].sort((left, right) => right.term.length - left.term.length || sortText(left.canonicalName, right.canonicalName))]));

  const sourceRows = new Map();
  let duplicateRetrievedRows = 0;
  for (const { dataset, rows } of collected) {
    for (const row of rows) {
      const normalized = {
        datasetId: dataset.id,
        Year: Number(row.Year),
        Mk: cleanText(row.Mk),
        Cn: cleanText(row.Cn),
        Ft: cleanText(row.Ft),
        engine_cc: numberOrNull(row.engine_cc),
        engine_kw: numberOrNull(row.engine_kw),
        registrations: Number(row.registrations) || 0,
      };
      if (!Number.isInteger(normalized.Year) || !normalized.Mk || !normalized.Cn) continue;
      const key = sourceKey(normalized);
      if (sourceRows.has(key)) {
        duplicateRetrievedRows += 1;
        const current = sourceRows.get(key);
        current.registrations = Math.max(current.registrations, normalized.registrations);
        current.datasetIds.add(dataset.id);
      } else {
        sourceRows.set(key, { ...normalized, datasetIds: new Set([dataset.id]) });
      }
    }
  }

  const unmappedMakes = new Map();
  for (const { dataset, metadata } of collected) {
    for (const makeRow of metadata.makeRows) {
      if (uniqueBrand(brandIndex, makeRow.rawMake)) continue;
      const current = unmappedMakes.get(makeRow.rawMake) || { rawMake: makeRow.rawMake, years: new Set(), datasetIds: new Set(), registrations: 0 };
      for (const year of dataset.years) current.years.add(year);
      current.datasetIds.add(dataset.id);
      current.registrations += makeRow.registrations;
      unmappedMakes.set(makeRow.rawMake, current);
    }
  }
  const unmatchedNames = new Map();
  const modelObservations = new Map();
  const modifications = new Map();
  const ambiguousMatches = new Map();
  let mappedSpecificationRows = 0;
  let matchedSpecificationRows = 0;
  let mappedRegistrations = 0;
  let matchedRegistrations = 0;

  for (const row of sourceRows.values()) {
    const brand = uniqueBrand(brandIndex, row.Mk);
    if (!brand) throw new Error(`Collector retrieved an unmapped make unexpectedly: ${row.Mk}`);
    mappedSpecificationRows += 1;
    mappedRegistrations += row.registrations;

    const match = exactModelMatch({ brand, commercialName: row.Cn, existingIndex, legacyIndex, prefixIndex });
    if (match.disposition.startsWith("ambiguous")) {
      const key = `${brand.id}:${normalizeTerm(row.Cn)}`;
      const current = ambiguousMatches.get(key) || { brandId: brand.id, brand: brand.canonicalName, commercialName: row.Cn, candidates: match.candidates, years: new Set(), specificationGroups: 0, registrations: 0 };
      current.years.add(row.Year);
      current.specificationGroups += 1;
      current.registrations += row.registrations;
      ambiguousMatches.set(key, current);
      continue;
    }
    if (match.disposition === "unmatched") {
      const key = `${brand.id}:${normalizeTerm(row.Cn)}`;
      const current = unmatchedNames.get(key) || { brandId: brand.id, brand: brand.canonicalName, commercialName: row.Cn, sourceMakeNames: new Set(), years: new Set(), specificationGroups: 0, registrations: 0 };
      current.sourceMakeNames.add(row.Mk);
      current.years.add(row.Year);
      current.specificationGroups += 1;
      current.registrations += row.registrations;
      unmatchedNames.set(key, current);
      continue;
    }

    matchedSpecificationRows += 1;
    matchedRegistrations += row.registrations;
    const modelKey = `${brand.id}:${normalizeTerm(match.canonicalName)}`;
    const model = modelObservations.get(modelKey) || {
      id: `eea-model-${stableId([brand.id, match.canonicalName])}`,
      brandId: brand.id,
      brand: brand.canonicalName,
      canonicalName: match.canonicalName,
      modelId: match.modelId,
      disposition: match.disposition,
      commercialNames: new Set(),
      sourceMakeNames: new Set(),
      years: new Set(),
      specificationGroups: 0,
      registrations: 0,
    };
    if (dispositionRank(match.disposition) < dispositionRank(model.disposition)) {
      model.disposition = match.disposition;
      model.modelId = match.modelId;
    }
    model.commercialNames.add(row.Cn);
    model.sourceMakeNames.add(row.Mk);
    model.years.add(row.Year);
    model.specificationGroups += 1;
    model.registrations += row.registrations;
    modelObservations.set(modelKey, model);

    const modificationKey = [modelKey, normalizeTerm(row.Ft), row.engine_cc ?? "", row.engine_kw ?? ""].join("\u0000");
    const modification = modifications.get(modificationKey) || {
      id: `eea-mod-${stableId([brand.id, match.canonicalName, normalizeTerm(row.Ft), row.engine_cc ?? "", row.engine_kw ?? ""])}`,
      brandId: brand.id,
      brand: brand.canonicalName,
      canonicalModel: match.canonicalName,
      modelId: match.modelId,
      modelDisposition: match.disposition,
      market: "Europe",
      yearFrom: row.Year,
      yearTo: row.Year,
      fuelSourceValue: row.Ft,
      engineCc: row.engine_cc,
      powerKw: row.engine_kw,
      commercialNames: new Set(),
      sourceMakeNames: new Set(),
      sourceDatasetIds: new Set(),
      specificationGroups: 0,
      registrations: 0,
      status: "review",
      safeAutomaticResolution: false,
    };
    if (dispositionRank(match.disposition) < dispositionRank(modification.modelDisposition)) {
      modification.modelDisposition = match.disposition;
      modification.modelId = match.modelId;
    }
    modification.yearFrom = Math.min(modification.yearFrom, row.Year);
    modification.yearTo = Math.max(modification.yearTo, row.Year);
    modification.commercialNames.add(row.Cn);
    modification.sourceMakeNames.add(row.Mk);
    for (const datasetId of row.datasetIds) modification.sourceDatasetIds.add(datasetId);
    modification.specificationGroups += 1;
    modification.registrations += row.registrations;
    modifications.set(modificationKey, modification);
  }

  const serializeSet = (values, sorter = sortText) => [...values].sort(sorter);
  const modelRecords = [...modelObservations.values()].map((row) => ({
    ...row,
    commercialNames: serializeSet(row.commercialNames),
    sourceMakeNames: serializeSet(row.sourceMakeNames),
    yearFrom: Math.min(...row.years),
    yearTo: Math.max(...row.years),
    years: serializeSet(row.years, (left, right) => left - right),
    safeAutomaticResolution: false,
  })).sort((left, right) => sortText(left.brand, right.brand) || sortText(left.canonicalName, right.canonicalName));

  const modificationRecords = [...modifications.values()].map((row) => ({
    ...row,
    commercialNames: serializeSet(row.commercialNames),
    sourceMakeNames: serializeSet(row.sourceMakeNames),
    sourceDatasetIds: serializeSet(row.sourceDatasetIds),
  })).sort((left, right) => sortText(left.brand, right.brand) || sortText(left.canonicalModel, right.canonicalModel) || left.yearFrom - right.yearFrom || sortText(left.fuelSourceValue, right.fuelSourceValue) || (left.engineCc ?? -1) - (right.engineCc ?? -1) || (left.powerKw ?? -1) - (right.powerKw ?? -1));

  const unmatchedRecords = [...unmatchedNames.values()].map((row) => ({
    ...row,
    sourceMakeNames: serializeSet(row.sourceMakeNames),
    years: serializeSet(row.years, (left, right) => left - right),
  })).sort((left, right) => right.registrations - left.registrations || sortText(left.brand, right.brand) || sortText(left.commercialName, right.commercialName));

  const unresolvedMakes = [...unmappedMakes.values()].map((row) => ({
    rawMake: row.rawMake,
    years: serializeSet(row.years, (left, right) => left - right),
    sourceDatasetIds: serializeSet(row.datasetIds),
    registrations: row.registrations,
  })).sort((left, right) => right.registrations - left.registrations || sortText(left.rawMake, right.rawMake));

  const ambiguousRecords = [...ambiguousMatches.values()].map((row) => ({
    ...row,
    years: serializeSet(row.years, (left, right) => left - right),
  })).sort((left, right) => right.registrations - left.registrations || sortText(left.brand, right.brand) || sortText(left.commercialName, right.commercialName));

  const byBrand = workspace.records.brand.map((brand) => {
    const models = modelRecords.filter((row) => row.brandId === brand.id);
    const brandModifications = modificationRecords.filter((row) => row.brandId === brand.id);
    const unmatched = unmatchedRecords.filter((row) => row.brandId === brand.id);
    return {
      brandId: brand.id,
      brand: brand.canonicalName,
      matchedCanonicalModels: models.length,
      exactCanonicalModels: models.filter((row) => row.disposition === "existing_model" || row.disposition === "legacy_exact_candidate").length,
      prefixMatchedCanonicalModels: models.filter((row) => row.disposition === "existing_model_prefix" || row.disposition === "legacy_prefix_candidate").length,
      existingModels: models.filter((row) => row.disposition === "existing_model").length,
      legacyExactCandidates: models.filter((row) => row.disposition === "legacy_exact_candidate").length,
      existingPrefixModels: models.filter((row) => row.disposition === "existing_model_prefix").length,
      legacyPrefixCandidates: models.filter((row) => row.disposition === "legacy_prefix_candidate").length,
      exactModificationCandidates: brandModifications.length,
      unmatchedCommercialNames: unmatched.length,
      matchedRegistrations: models.reduce((sum, row) => sum + row.registrations, 0),
    };
  }).filter((row) => row.matchedCanonicalModels || row.unmatchedCommercialNames)
    .sort((left, right) => right.matchedRegistrations - left.matchedRegistrations || sortText(left.brand, right.brand));

  await rm(REPORT_DIR, { recursive: true, force: true });
  await mkdir(REPORT_DIR, { recursive: true });
  const collections = {
    modelIntersections: await writeReportCollection("model-intersections", "eea_model_intersection", modelRecords),
    modificationCandidates: await writeReportCollection("modifications", "eea_modification_candidate", modificationRecords),
    unmatchedCommercialNames: await writeReportCollection("unmatched-commercial-names", "eea_unmatched_commercial_name", unmatchedRecords),
    ambiguousModelMatches: await writeReportCollection("ambiguous-model-matches", "eea_ambiguous_model_match", ambiguousRecords),
  };

  const datasetSummaries = collected.map(({ dataset, metadata, rows }) => ({
    id: dataset.id,
    title: dataset.title,
    table: dataset.table,
    years: dataset.years,
    status: dataset.status,
    url: dataset.url,
    detailedTypeVariantVersionGroups: metadata.detailedTypeVariantVersionGroups,
    specificationGroups: metadata.specificationGroups,
    makeCommercialNameGroups: metadata.makeCommercialNameGroups,
    rawMakeNames: metadata.makeRows.length,
    mappedRawMakeNames: metadata.makeRows.filter((row) => uniqueBrand(brandIndex, row.rawMake)).length,
    retrievedSpecificationRows: rows.length,
  }));

  const report = {
    schemaVersion: 2,
    generatedAt,
    productionConnected: false,
    source: {
      publisher: "European Environment Agency",
      registry: "Monitoring of CO2 emissions from new passenger cars — Regulation (EU) 2019/631",
      api: ENDPOINT,
      datasets: datasetSummaries,
    },
    window: { yearFrom: 2020, yearTo: 2025, market: "Europe" },
    policy: {
      sameBrandKnownModelBoundaryRequired: true,
      trimRichCommercialNameRequiresUniqueLongestKnownModelPrefix: true,
      trimRichCommercialNamesPromotedToModels: false,
      modificationIdentity: ["canonicalModel", "fuelSourceValue", "engineCc", "powerKw"],
      officialTypeVariantVersionGroupsAreDenominatorNotCanonicalModels: true,
      generationInferred: false,
      importedStatus: "review",
      safeAutomaticResolution: false,
      completionClaimAllowed: false,
    },
    totals: {
      sourceDatasets: DATASETS.length,
      detailedTypeVariantVersionGroups: datasetSummaries.reduce((sum, row) => sum + row.detailedTypeVariantVersionGroups, 0),
      sourceSpecificationGroups: datasetSummaries.reduce((sum, row) => sum + row.specificationGroups, 0),
      sourceMakeCommercialNameGroups: datasetSummaries.reduce((sum, row) => sum + row.makeCommercialNameGroups, 0),
      downloadedMappedSpecificationGroups: sourceRows.size,
      duplicateRetrievedRows,
      rawMakeNames: new Set(collected.flatMap(({ metadata }) => metadata.makeRows.map((row) => row.rawMake))).size,
      mappedRawMakeNames: new Set(collected.flatMap(({ metadata }) => metadata.makeRows.filter((row) => uniqueBrand(brandIndex, row.rawMake)).map((row) => row.rawMake))).size,
      mappedSpecificationGroups: mappedSpecificationRows,
      mappedRegistrations,
      exactMatchedSpecificationGroups: matchedSpecificationRows,
      matchedRegistrations,
      matchedCanonicalModels: modelRecords.length,
      exactCanonicalModels: modelRecords.filter((row) => row.disposition === "existing_model" || row.disposition === "legacy_exact_candidate").length,
      prefixMatchedCanonicalModels: modelRecords.filter((row) => row.disposition === "existing_model_prefix" || row.disposition === "legacy_prefix_candidate").length,
      existingCanonicalModels: modelRecords.filter((row) => row.disposition === "existing_model").length,
      newLegacyExactModelCandidates: modelRecords.filter((row) => row.disposition === "legacy_exact_candidate").length,
      existingPrefixMatchedModels: modelRecords.filter((row) => row.disposition === "existing_model_prefix").length,
      newLegacyPrefixModelCandidates: modelRecords.filter((row) => row.disposition === "legacy_prefix_candidate").length,
      exactModificationCandidates: modificationRecords.length,
      unmatchedCommercialNames: unmatchedRecords.length,
      ambiguousModelMatches: ambiguousRecords.length,
      unresolvedRawMakes: unresolvedMakes.length,
      publicationReadyModels: 0,
      publicationReadyModifications: 0,
    },
    unresolvedRawMakes: unresolvedMakes,
    byBrand,
    collections,
    reportDirectory: "reports/model-eea-europe-2020-2025",
    nextGate: "Resolve generation/body and marketed-model boundaries before converting EEA modification candidates to canonical V2 variants.",
  };
  await writeJson(path.join(REPORT_DIR, "manifest.json"), report);
  await writeJson(REPORT_FILE, report);
  await rm(CHECKPOINT_DIR, { recursive: true, force: true });
  return report;
}

async function main() {
  const report = await collectEeaEuropeModels();
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
