import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, readJson, writeJson } from "./lib.mjs";

const LEGACY_ROOT = path.resolve(WORKSPACE_ROOT, "../vehicle-knowledge");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/drom-reviewed-generation-variant-01.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/drom-reviewed-generation-variant-01-2026-08-17.json");
const WINDOW_END = 2026;

const BODY_TYPE_MAP = new Map([
  ["suv", "SUV"],
  ["hatchback", "Hatchback"],
  ["sedan", "Sedan"],
  ["minivan", "Minivan"],
  ["wagon", "Station wagon"],
  ["coupe", "Coupe"],
  ["pickup", "Pickup"],
]);

const FUEL_MAP = new Map([
  ["petrol", "Petrol"],
  ["diesel", "Diesel"],
  ["lpg", "LPG"],
]);

const TRANSMISSION_MAP = new Map([
  ["automatic", "Automatic"],
  ["manual", "Manual"],
  ["dct", "DCT"],
  ["cvt", "CVT"],
]);

const DRIVE_MAP = new Map([
  ["fwd", "FWD"],
  ["awd", "AWD"],
  ["rwd", "RWD"],
]);

const ORDINALS = [
  "Zero", "First", "Second", "Third", "Fourth", "Fifth",
  "Sixth", "Seventh", "Eighth", "Ninth", "Tenth",
];

function chunks(entityType, records) {
  return Array.from({ length: Math.ceil(records.length / 250) }, (_, index) => ({
    schemaVersion: 2,
    entityType,
    chunk: index + 1,
    maxRecords: 250,
    records: records.slice(index * 250, (index + 1) * 250),
  }));
}

function hash(value, length = 20) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function month(value, fallbackYear = null) {
  if (value && /^\d{4}-\d{2}/.test(String(value))) return String(value).slice(0, 7);
  if (value && /^\d{4}/.test(String(value))) return String(value).slice(0, 4);
  return Number.isFinite(fallbackYear) ? String(fallbackYear) : null;
}

function minMonth(rows) {
  return rows.map((row) => month(row.productionFrom, row.yearFrom)).filter(Boolean).sort()[0] || null;
}

function maxMonth(rows) {
  if (rows.some((row) => !row.productionTo && !Number.isFinite(row.yearTo))) return null;
  return rows.map((row) => month(row.productionTo, row.yearTo)).filter(Boolean).sort().at(-1) || null;
}

function stripRestyle(value) {
  return String(value || "").replace(/,\s*рестайлинг(?:\s*\d+)?$/iu, "").trim();
}

function restyleNumber(value) {
  const match = String(value || "").match(/,\s*рестайлинг(?:\s*(\d+))?$/iu);
  return match ? Number(match[1] || 1) : null;
}

function generationIdentity(modelId, sourceLabel) {
  const label = stripRestyle(sourceLabel);
  const numbered = label.match(/^(\d+)\s+поколение$/iu);
  if (numbered) {
    const number = Number(numbered[1]);
    return {
      id: `${modelId}/drom-generation-${number}`,
      name: `${ORDINALS[number] || `${number}th`} generation`,
      platformCodes: [],
      sourceLabel: label,
    };
  }
  const platformCodes = label.split("/").map((value) => value.trim()).filter(Boolean);
  return {
    id: `${modelId}/drom-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    name: label,
    platformCodes,
    sourceLabel: label,
  };
}

function sourceMetadata(row) {
  const url = row.sourceUrl;
  const domain = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  if (row.sourceType === "manufacturer" && domain.endsWith("toyota.jp")) {
    return {
      id: `src-toyota-legacy-${hash(url, 16)}`,
      type: url.toLowerCase().endsWith(".pdf") ? "manufacturer_technical_document" : "manufacturer",
      publisher: "Toyota",
      title: `Toyota archived technical source for ${row.model}`,
      market: "Japan",
      language: "ja",
      confidence: "official",
    };
  }
  if (row.sourceType === "manufacturer" && domain.endsWith("volkswagen-newsroom.com")) {
    return {
      id: `src-volkswagen-legacy-${hash(url, 16)}`,
      type: "manufacturer",
      publisher: "Volkswagen",
      title: `Volkswagen Newsroom technical source for ${row.model}`,
      market: "Global",
      language: "en",
      confidence: "official",
    };
  }
  return {
    id: `src-drom-catalog-${hash(url, 16)}`,
    type: "authoritative_catalog",
    publisher: "Drom",
    title: `Drom catalog specifications for ${row.make} ${row.model}`,
    market: null,
    language: "ru",
    confidence: "high",
  };
}

function sourceId(row) {
  return sourceMetadata(row).id;
}

function sourceRecord(row) {
  const metadata = sourceMetadata(row);
  return {
    id: metadata.id,
    type: metadata.type,
    title: metadata.title,
    publisher: metadata.publisher,
    url: row.sourceUrl,
    documentId: null,
    documentDate: null,
    verifiedAt: String(row.verifiedAt || "2026-08-06").slice(0, 10),
    market: metadata.market,
    language: metadata.language,
    supportedFields: [
      "name", "market", "productionFrom", "productionTo", "bodyTypes", "platformCodes",
      "yearFrom", "yearTo", "bodyType", "powertrainKind", "fuel", "engineCc",
      "transmission", "drive", "powerHp",
    ],
    confidence: metadata.confidence,
    status: "active",
    license: null,
    notes: metadata.publisher === "Drom"
      ? "Secondary catalog evidence imported from the existing AvtoCena research database. Review-only; no market applicability, engine code, power standard or derived kW value is inferred."
      : "Manufacturer evidence retained from the existing AvtoCena research database. Review-only pending the V2 publication gate.",
  };
}

function sourceIds(rows) {
  return [...new Set(rows.map(sourceId))].sort();
}

function aliases(values, rows, { language = null, kind = "source_spelling" } = {}) {
  const ids = sourceIds(rows);
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, "en")).map((value) => ({
    value,
    kind,
    safe: false,
    language,
    market: null,
    sourceIds: ids,
  }));
}

function evidenceFor(rows, fields, note) {
  const representative = new Map(rows.map((row) => [sourceId(row), row]));
  return [...representative.entries()].sort(([left], [right]) => left.localeCompare(right, "en")).map(([id, row]) => ({
    sourceId: id,
    fields,
    status: "verified",
    confidence: sourceMetadata(row).confidence,
    note,
  }));
}

function bodyTypes(rows) {
  return [...new Set(rows.map((row) => BODY_TYPE_MAP.get(row.bodyType)).filter(Boolean))].sort();
}

function marketForRows(rows) {
  const markets = [...new Set(rows.map((row) => sourceMetadata(row).market).filter(Boolean))];
  return markets.length === 1 ? markets[0] : "Reference catalog";
}

function variantKey(row) {
  return [
    row.modelId,
    row.generation,
    row.yearFrom,
    row.yearTo ?? "",
    row.engineCc,
    row.fuel,
    row.transmission ?? "",
    row.drive ?? "",
    row.bodyType,
    row.powerHp,
  ].join("|");
}

function variantName(model, generation, row) {
  const parts = [model.canonicalName, `${row.engineCc} cc`, `${row.powerHp} hp`];
  const transmission = TRANSMISSION_MAP.get(row.transmission);
  const drive = DRIVE_MAP.get(row.drive);
  if (transmission) parts.push(transmission);
  if (drive) parts.push(drive);
  return `${parts.join(" ")} — ${generation.name}${restyleNumber(row.generation) ? " facelift" : ""}`;
}

async function loadLegacyVariants() {
  const files = (await readdir(LEGACY_ROOT)).filter((file) => /^variants-\d{4}-.*\.json$/.test(file)).sort();
  const rows = [];
  for (const file of files) rows.push(...await readJson(path.join(LEGACY_ROOT, file)));
  return rows;
}

export async function buildDromReviewedGenerationVariantBatch01() {
  const [workspace, legacyVariants] = await Promise.all([loadWorkspace(), loadLegacyVariants()]);
  const brands = new Map(workspace.records.brand.map((brand) => [brand.id, brand]));
  const models = new Map(workspace.records.model.map((model) => [model.id, model]));
  const modelsWithGenerations = new Set(workspace.records.generation.map((generation) => generation.modelId));
  const rejected = {
    exactModelMissing: 0,
    existingGenerationProtected: 0,
    outsidePriorityWindow: 0,
    ambiguousHybridPowertrain: 0,
    unsupportedFuel: 0,
    bodyTypeMissing: 0,
    incompleteCoreSpecification: 0,
  };
  const priorityRows = [];

  for (const row of legacyVariants) {
    const model = models.get(row.modelId);
    if (!model) {
      rejected.exactModelMissing += 1;
      continue;
    }
    if (modelsWithGenerations.has(row.modelId)) {
      rejected.existingGenerationProtected += 1;
      continue;
    }
    const brand = brands.get(model.brandId);
    const cutoff = brand?.countries?.includes("Japan") ? 2015 : 2020;
    const from = Number.isFinite(row.yearFrom) ? row.yearFrom : row.yearTo;
    const to = Number.isFinite(row.yearTo) ? row.yearTo : row.yearFrom;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < cutoff || from > WINDOW_END) {
      rejected.outsidePriorityWindow += 1;
      continue;
    }
    if (row.powertrainKind !== "combustion") {
      rejected.ambiguousHybridPowertrain += 1;
      continue;
    }
    if (!FUEL_MAP.has(row.fuel)) {
      rejected.unsupportedFuel += 1;
      continue;
    }
    if (!BODY_TYPE_MAP.has(row.bodyType)) {
      rejected.bodyTypeMissing += 1;
      continue;
    }
    if (!row.generation || !Number.isFinite(row.yearFrom) || !Number.isFinite(row.engineCc) || !Number.isFinite(row.powerHp) || !row.sourceUrl) {
      rejected.incompleteCoreSpecification += 1;
      continue;
    }
    priorityRows.push(row);
  }

  const sourceMap = new Map(priorityRows.map((row) => [sourceId(row), sourceRecord(row)]));
  const generationGroups = new Map();
  for (const row of priorityRows) {
    const identity = generationIdentity(row.modelId, row.generation);
    const rows = generationGroups.get(identity.id) || [];
    rows.push(row);
    generationGroups.set(identity.id, rows);
  }

  const generations = [];
  const facelifts = [];
  for (const [id, rows] of [...generationGroups.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    const identity = generationIdentity(rows[0].modelId, rows[0].generation);
    const originalLabels = [...new Set(rows.map((row) => stripRestyle(row.generation)))];
    const generationAliases = rows.flatMap((row) => row.generationAliases || []);
    const from = minMonth(rows);
    const to = maxMonth(rows);
    const bodies = bodyTypes(rows);
    const fields = ["name", "productionFrom", "bodyTypes"];
    if (to) fields.push("productionTo");
    if (identity.platformCodes.length) fields.push("platformCodes");
    generations.push({
      id,
      modelId: rows[0].modelId,
      name: identity.name,
      aliases: [
        ...aliases(originalLabels, rows, { language: /\p{Script=Cyrillic}/u.test(originalLabels[0] || "") ? "ru" : null, kind: "localized" }),
        ...aliases(generationAliases, rows),
      ].filter((alias, index, all) => all.findIndex((candidate) => candidate.value === alias.value) === index),
      platformCodes: identity.platformCodes,
      productionFrom: from,
      productionTo: to,
      bodyTypes: bodies,
      status: "review",
      evidence: evidenceFor(rows, fields, "Generation grouping, production boundary and body classification are retained from exact legacy source records; the English ordinal is a direct normalization of the source label."),
      researchNotes: [
        "Review-only Drom/legacy generation group for an exact V2 model identity.",
        "The batch is isolated from models that already had a reviewed V2 generation, so it cannot overwrite stronger official research.",
      ],
      updatedAt: "2026-08-17",
    });

    const restyledByNumber = new Map();
    for (const row of rows) {
      const number = restyleNumber(row.generation);
      if (number === null) continue;
      const group = restyledByNumber.get(number) || [];
      group.push(row);
      restyledByNumber.set(number, group);
    }
    for (const [number, restyledRows] of [...restyledByNumber.entries()].sort(([left], [right]) => left - right)) {
      const faceliftFrom = minMonth(restyledRows);
      const faceliftTo = maxMonth(restyledRows);
      const faceliftFields = ["name", "productionFrom"];
      if (faceliftTo) faceliftFields.push("productionTo");
      facelifts.push({
        id: `${id}/facelift-${number}`,
        generationId: id,
        name: number === 1 ? "Facelift" : `${ORDINALS[number] || `${number}th`} facelift`,
        aliases: aliases([...new Set(restyledRows.map((row) => row.generation))], restyledRows, { language: "ru", kind: "localized" }),
        productionFrom: faceliftFrom,
        productionTo: faceliftTo,
        status: "review",
        evidence: evidenceFor(restyledRows, faceliftFields, "The facelift label and its observed production range are retained from exact legacy source records; the public label is normalized to English."),
        researchNotes: ["Review-only facelift boundary; no trim or market applicability is inferred."],
        updatedAt: "2026-08-17",
      });
    }
  }

  const variantGroups = new Map();
  for (const row of priorityRows) {
    const key = variantKey(row);
    const rows = variantGroups.get(key) || [];
    rows.push(row);
    variantGroups.set(key, rows);
  }
  const variants = [];
  for (const [key, rows] of [...variantGroups.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    const row = [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id), "en"))[0];
    const model = models.get(row.modelId);
    const generation = generationIdentity(row.modelId, row.generation);
    const faceliftNumber = restyleNumber(row.generation);
    const transmission = TRANSMISSION_MAP.get(row.transmission);
    const drive = DRIVE_MAP.get(row.drive);
    const fields = ["name", "market", "yearFrom", "bodyType", "powertrainKind", "fuel", "engineCc", "powerHp"];
    if (Number.isFinite(row.yearTo)) fields.push("yearTo");
    if (transmission) fields.push("transmission");
    if (drive) fields.push("drive");
    variants.push({
      id: `${generation.id}/${faceliftNumber ? `facelift-${faceliftNumber}/` : ""}drom-${hash(key)}`,
      modelId: row.modelId,
      generationId: generation.id,
      faceliftId: faceliftNumber ? `${generation.id}/facelift-${faceliftNumber}` : null,
      name: variantName(model, generation, row),
      aliases: [],
      market: marketForRows(rows),
      yearFrom: row.yearFrom,
      yearTo: Number.isFinite(row.yearTo) ? row.yearTo : null,
      bodyType: BODY_TYPE_MAP.get(row.bodyType),
      powertrainKind: "ICE",
      fuel: FUEL_MAP.get(row.fuel),
      engineCc: row.engineCc,
      ...(transmission ? { transmission } : {}),
      ...(drive ? { drive } : {}),
      powerHp: row.powerHp,
      status: "review",
      evidence: evidenceFor(rows, fields, "Exact source specification retained after duplicate legacy rows were merged. No engine code, horsepower standard, derived kW value, sales-market applicability or 30-minute power is inferred."),
      researchNotes: [
        `Merged ${rows.length} exact legacy source row(s): ${rows.map((item) => item.id).sort().join(", ")}.`,
        "Market is recorded as Reference catalog unless an official manufacturer source explicitly states Japan or global scope.",
        "Review-only: this specification cannot auto-resolve pricing until its source spelling and generation are separately approved.",
      ],
      updatedAt: "2026-08-17",
    });
  }

  const sources = [...sourceMap.values()].sort((left, right) => left.id.localeCompare(right.id, "en"));
  generations.sort((left, right) => left.id.localeCompare(right.id, "en"));
  facelifts.sort((left, right) => left.id.localeCompare(right.id, "en"));
  variants.sort((left, right) => left.id.localeCompare(right.id, "en"));
  const report = {
    schemaVersion: 2,
    generatedAt: "2026-08-17",
    productionConnected: false,
    inputLegacyVariants: legacyVariants.length,
    acceptedSourceRows: priorityRows.length,
    duplicateSourceRowsMerged: priorityRows.length - variants.length,
    acceptedSources: sources.length,
    acceptedModels: new Set(variants.map((variant) => variant.modelId)).size,
    acceptedGenerations: generations.length,
    acceptedFacelifts: facelifts.length,
    acceptedVariants: variants.length,
    rejected,
    policy: {
      japanPriorityWindow: "2015-2026 (overlapping production records retained with their true start year)",
      otherMarketsPriorityWindow: "2020-2026 (overlapping production records retained with their true start year)",
      exactExistingModelRequired: true,
      existingReviewedGenerationProtected: true,
      ambiguousHybridPowertrainRejected: true,
      missingBodyTypeRejected: true,
      engineCodeNotPromoted: true,
      derivedPowerKwNotPromoted: true,
      automaticPublicationReady: false,
    },
    sourceIds: sources.map((source) => source.id),
    modelIds: [...new Set(variants.map((variant) => variant.modelId))].sort(),
    generationIds: generations.map((generation) => generation.id),
    faceliftIds: facelifts.map((facelift) => facelift.id),
    variantIds: variants.map((variant) => variant.id),
  };
  return {
    report,
    ingestion: {
      schemaVersion: 2,
      batches: [
        ...chunks("source", sources),
        ...chunks("generation", generations),
        ...chunks("facelift", facelifts),
        ...chunks("variant", variants),
      ],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildDromReviewedGenerationVariantBatch01();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify({
    acceptedSourceRows: report.acceptedSourceRows,
    duplicateSourceRowsMerged: report.duplicateSourceRowsMerged,
    acceptedSources: report.acceptedSources,
    acceptedModels: report.acceptedModels,
    acceptedGenerations: report.acceptedGenerations,
    acceptedFacelifts: report.acceptedFacelifts,
    acceptedVariants: report.acceptedVariants,
    rejected: report.rejected,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
