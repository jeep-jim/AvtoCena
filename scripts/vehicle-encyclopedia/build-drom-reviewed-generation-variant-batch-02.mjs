import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, readJson, writeJson } from "./lib.mjs";

const LEGACY_ROOT = path.resolve(WORKSPACE_ROOT, "../vehicle-knowledge");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/drom-reviewed-generation-variant-02.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/drom-reviewed-generation-variant-02-2026-08-17.json");
const WINDOW_END = 2026;

const MISSING_MODEL_IDS = new Set(["mazda/axela", "volkswagen/lavida"]);
const EXISTING_GENERATION_RULES = new Map([
  ["honda/fit", { generationId: "honda/fit/japan-2020", sourceGeneration: /^4 поколение/iu }],
  ["honda/vezel", { generationId: "honda/vezel/japan-2021", sourceGeneration: /^2 поколение/iu }],
  ["toyota/rav4", { generationId: "toyota/rav4/xa50", sourceGeneration: /^XA50$/iu }],
  ["toyota/yaris", { generationId: "toyota/yaris/japan-2020", sourceGeneration: /^4 поколение/iu, bodyType: "hatchback" }],
]);

const BODY_TYPE_MAP = new Map([
  ["suv", "SUV"],
  ["hatchback", "Hatchback"],
  ["sedan", "Sedan"],
  ["minivan", "Minivan"],
  ["wagon", "Station wagon"],
  ["coupe", "Coupe"],
  ["pickup", "Pickup"],
]);
const FUEL_MAP = new Map([["petrol", "Petrol"], ["diesel", "Diesel"], ["lpg", "LPG"]]);
const TRANSMISSION_MAP = new Map([["automatic", "Automatic"], ["manual", "Manual"], ["dct", "DCT"], ["cvt", "CVT"]]);
const DRIVE_MAP = new Map([["fwd", "FWD"], ["awd", "AWD"], ["rwd", "RWD"]]);
const ORDINALS = ["Zero", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];

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
    return { id: `${modelId}/drom-generation-${number}`, name: `${ORDINALS[number] || `${number}th`} generation`, platformCodes: [] };
  }
  const platformCodes = label.split("/").map((value) => value.trim()).filter(Boolean);
  return {
    id: `${modelId}/drom-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    name: label,
    platformCodes,
  };
}

function sourceId(row) {
  return `src-drom-catalog-${hash(row.sourceUrl, 16)}`;
}

function sourceRecord(row) {
  return {
    id: sourceId(row),
    type: "authoritative_catalog",
    title: `Drom catalog specifications for ${row.make} ${row.model}`,
    publisher: "Drom",
    url: row.sourceUrl,
    documentId: null,
    documentDate: null,
    verifiedAt: String(row.verifiedAt || "2026-08-06").slice(0, 10),
    market: null,
    language: "ru",
    supportedFields: [
      "canonicalName", "sourceNames", "productionFrom", "productionTo", "bodyTypes", "powertrainKinds",
      "name", "platformCodes", "market", "yearFrom", "yearTo", "bodyType", "powertrainKind", "fuel",
      "engineCc", "transmission", "drive", "powerHp",
    ],
    confidence: "high",
    status: "active",
    license: null,
    notes: "Secondary catalog evidence imported from the existing AvtoCena research database. Review-only; no market applicability, engine code, power standard or derived kW value is inferred.",
  };
}

function evidence(rows, fields, note) {
  return [...new Set(rows.map(sourceId))].sort().map((id) => ({
    sourceId: id,
    fields,
    status: "verified",
    confidence: "high",
    note,
  }));
}

function alias(value, rows, kind = "source_spelling") {
  return {
    value,
    kind,
    safe: false,
    language: /\p{Script=Cyrillic}/u.test(value) ? "ru" : null,
    market: null,
    sourceIds: [...new Set(rows.map(sourceId))].sort(),
  };
}

function bodyTypes(rows) {
  return [...new Set(rows.map((row) => BODY_TYPE_MAP.get(row.bodyType)).filter(Boolean))].sort();
}

function validCoreRow(row) {
  return row.powertrainKind === "combustion"
    && FUEL_MAP.has(row.fuel)
    && BODY_TYPE_MAP.has(row.bodyType)
    && Boolean(row.generation)
    && Number.isFinite(row.yearFrom)
    && Number.isFinite(row.engineCc)
    && Number.isFinite(row.powerHp)
    && Boolean(row.sourceUrl);
}

function overlapsWindow(row, cutoff) {
  const to = Number.isFinite(row.yearTo) ? row.yearTo : row.yearFrom;
  return row.yearFrom <= WINDOW_END && to >= cutoff;
}

function generationContains(generation, row) {
  const from = Number(String(generation.productionFrom).slice(0, 4));
  const to = generation.productionTo ? Number(String(generation.productionTo).slice(0, 4)) : WINDOW_END;
  const rowTo = Number.isFinite(row.yearTo) ? row.yearTo : row.yearFrom;
  return Number.isFinite(from) && row.yearFrom >= from && rowTo <= to;
}

function sourceSpecificationKey(row) {
  return [
    row.modelId, row.generation, row.yearFrom, row.yearTo ?? "", row.engineCc, row.fuel,
    row.transmission ?? "", row.drive ?? "", row.bodyType, row.powerHp,
  ].join("|");
}

function stagedSpecificationKey(generationId, row) {
  return [
    row.modelId, generationId, row.yearFrom, row.yearTo ?? "", row.engineCc, FUEL_MAP.get(row.fuel),
    TRANSMISSION_MAP.get(row.transmission) ?? "", DRIVE_MAP.get(row.drive) ?? "", BODY_TYPE_MAP.get(row.bodyType), row.powerHp,
  ].join("|");
}

function existingSpecificationKey(variant) {
  return [
    variant.modelId, variant.generationId, variant.yearFrom, variant.yearTo ?? "", variant.engineCc,
    variant.fuel, variant.transmission ?? "", variant.drive ?? "", variant.bodyType, variant.powerHp ?? "",
  ].join("|");
}

function variantName(model, generationName, row) {
  const parts = [model.canonicalName, `${row.engineCc} cc`, `${row.powerHp} hp`];
  if (TRANSMISSION_MAP.has(row.transmission)) parts.push(TRANSMISSION_MAP.get(row.transmission));
  if (DRIVE_MAP.has(row.drive)) parts.push(DRIVE_MAP.get(row.drive));
  return `${parts.join(" ")} — ${generationName}`;
}

async function loadLegacyVariants() {
  const files = (await readdir(LEGACY_ROOT)).filter((file) => /^variants-\d{4}-.*\.json$/.test(file)).sort();
  const rows = [];
  for (const file of files) rows.push(...await readJson(path.join(LEGACY_ROOT, file)));
  return rows;
}

export async function buildDromReviewedGenerationVariantBatch02() {
  const [workspace, legacyVariants] = await Promise.all([loadWorkspace(), loadLegacyVariants()]);
  const brands = new Map(workspace.records.brand.map((brand) => [brand.id, brand]));
  const existingModels = new Map(workspace.records.model.map((model) => [model.id, model]));
  const existingGenerations = new Map(workspace.records.generation.map((generation) => [generation.id, generation]));
  const existingSourceIds = new Set(workspace.records.source.map((source) => source.id));
  const existingKeys = new Set(workspace.records.variant.map(existingSpecificationKey));
  const rejected = {
    outsideSelectedIdentities: 0,
    incompleteOrAmbiguousSpecification: 0,
    outsidePriorityWindow: 0,
    existingGenerationRuleMismatch: 0,
    duplicateExistingSpecification: 0,
  };

  const missingModelRows = [];
  const existingGenerationRows = [];
  for (const row of legacyVariants) {
    const selectedMissingModel = MISSING_MODEL_IDS.has(row.modelId);
    const existingRule = EXISTING_GENERATION_RULES.get(row.modelId);
    if (!selectedMissingModel && !existingRule) {
      rejected.outsideSelectedIdentities += 1;
      continue;
    }
    if (!validCoreRow(row)) {
      rejected.incompleteOrAmbiguousSpecification += 1;
      continue;
    }
    const brandId = existingModels.get(row.modelId)?.brandId || row.modelId.split("/")[0];
    const cutoff = brands.get(brandId)?.countries?.includes("Japan") ? 2015 : 2020;
    if (!overlapsWindow(row, cutoff)) {
      rejected.outsidePriorityWindow += 1;
      continue;
    }
    if (selectedMissingModel) {
      missingModelRows.push(row);
      continue;
    }
    const targetGeneration = existingGenerations.get(existingRule.generationId);
    if (!existingRule.sourceGeneration.test(row.generation)
      || (existingRule.bodyType && existingRule.bodyType !== row.bodyType)
      || !targetGeneration
      || !generationContains(targetGeneration, row)) {
      rejected.existingGenerationRuleMismatch += 1;
      continue;
    }
    if (existingKeys.has(stagedSpecificationKey(existingRule.generationId, row))) {
      rejected.duplicateExistingSpecification += 1;
      continue;
    }
    existingGenerationRows.push({ row, generationId: existingRule.generationId });
  }

  const sourceRows = [...missingModelRows, ...existingGenerationRows.map((item) => item.row)];
  const sources = [...new Map(sourceRows.map((row) => [sourceId(row), sourceRecord(row)])).values()]
    .filter((source) => !existingSourceIds.has(source.id))
    .sort((left, right) => left.id.localeCompare(right.id, "en"));

  const modelGroups = new Map();
  for (const row of missingModelRows) {
    const rows = modelGroups.get(row.modelId) || [];
    rows.push(row);
    modelGroups.set(row.modelId, rows);
  }
  const models = [...modelGroups.entries()].sort(([left], [right]) => left.localeCompare(right, "en")).map(([modelId, rows]) => ({
    id: modelId,
    brandId: modelId.split("/")[0],
    canonicalName: rows[0].model,
    slug: modelId.split("/").at(-1),
    aliases: [],
    sourceNames: [alias(rows[0].model, rows)],
    productionFrom: minMonth(rows),
    productionTo: maxMonth(rows),
    bodyTypes: bodyTypes(rows),
    powertrainKinds: ["ICE"],
    mediaIds: [],
    status: "review",
    evidence: evidence(rows, ["canonicalName", "sourceNames", "productionFrom", "productionTo", "bodyTypes", "powertrainKinds"], "Exact legacy catalog model spelling and the observed in-window production/body/powertrain envelope; review-only pending preferred-source confirmation."),
    researchNotes: [
      "Added only because exact legacy specifications overlap the priority window and the canonical brand identity already exists.",
      "No localized alias, market applicability, media asset or production scope outside the observed source rows is inferred.",
    ],
    updatedAt: "2026-08-17",
  }));

  const generationGroups = new Map();
  for (const row of missingModelRows) {
    const identity = generationIdentity(row.modelId, row.generation);
    const rows = generationGroups.get(identity.id) || [];
    rows.push(row);
    generationGroups.set(identity.id, rows);
  }
  const generations = [];
  const facelifts = [];
  for (const [id, rows] of [...generationGroups.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    const identity = generationIdentity(rows[0].modelId, rows[0].generation);
    const to = maxMonth(rows);
    const fields = ["name", "productionFrom", "bodyTypes"];
    if (to) fields.push("productionTo");
    generations.push({
      id,
      modelId: rows[0].modelId,
      name: identity.name,
      aliases: [alias(stripRestyle(rows[0].generation), rows, "localized")],
      platformCodes: identity.platformCodes,
      productionFrom: minMonth(rows),
      productionTo: to,
      bodyTypes: bodyTypes(rows),
      status: "review",
      evidence: evidence(rows, fields, "Exact legacy catalog generation grouping and observed production/body envelope; the English ordinal is a direct normalization of the source label."),
      researchNotes: ["Review-only secondary-catalog generation; no platform code or sales-market applicability is inferred."],
      updatedAt: "2026-08-17",
    });
    const faceliftGroups = new Map();
    for (const row of rows) {
      const number = restyleNumber(row.generation);
      if (number === null) continue;
      const grouped = faceliftGroups.get(number) || [];
      grouped.push(row);
      faceliftGroups.set(number, grouped);
    }
    for (const [number, faceliftRows] of [...faceliftGroups.entries()].sort(([left], [right]) => left - right)) {
      facelifts.push({
        id: `${id}/facelift-${number}`,
        generationId: id,
        name: number === 1 ? "Facelift" : `${ORDINALS[number] || `${number}th`} facelift`,
        aliases: [alias(faceliftRows[0].generation, faceliftRows, "localized")],
        productionFrom: minMonth(faceliftRows),
        productionTo: maxMonth(faceliftRows),
        status: "review",
        evidence: evidence(faceliftRows, ["name", "productionFrom", "productionTo"], "The source facelift label and observed production range are preserved; the public label is normalized to English."),
        researchNotes: ["Review-only facelift boundary; no trim or market applicability is inferred."],
        updatedAt: "2026-08-17",
      });
    }
  }

  const variantGroups = new Map();
  for (const row of missingModelRows) {
    const generation = generationIdentity(row.modelId, row.generation);
    const key = `${generation.id}|${sourceSpecificationKey(row)}`;
    const grouped = variantGroups.get(key) || { rows: [], generationId: generation.id, generationName: generation.name, faceliftId: null };
    grouped.rows.push(row);
    const number = restyleNumber(row.generation);
    grouped.faceliftId = number ? `${generation.id}/facelift-${number}` : null;
    variantGroups.set(key, grouped);
  }
  for (const item of existingGenerationRows) {
    const key = `${item.generationId}|${sourceSpecificationKey(item.row)}`;
    const grouped = variantGroups.get(key) || {
      rows: [],
      generationId: item.generationId,
      generationName: existingGenerations.get(item.generationId).name,
      faceliftId: null,
    };
    grouped.rows.push(item.row);
    variantGroups.set(key, grouped);
  }

  const variants = [...variantGroups.entries()].sort(([left], [right]) => left.localeCompare(right, "en")).map(([key, grouped]) => {
    const row = [...grouped.rows].sort((left, right) => left.id.localeCompare(right.id, "en"))[0];
    const model = existingModels.get(row.modelId) || models.find((candidate) => candidate.id === row.modelId);
    const transmission = TRANSMISSION_MAP.get(row.transmission);
    const drive = DRIVE_MAP.get(row.drive);
    const fields = ["name", "market", "yearFrom", "bodyType", "powertrainKind", "fuel", "engineCc", "powerHp"];
    if (Number.isFinite(row.yearTo)) fields.push("yearTo");
    if (transmission) fields.push("transmission");
    if (drive) fields.push("drive");
    return {
      id: `${grouped.generationId}/${grouped.faceliftId ? `${grouped.faceliftId.split("/").at(-1)}/` : ""}drom-${hash(key)}`,
      modelId: row.modelId,
      generationId: grouped.generationId,
      faceliftId: grouped.faceliftId,
      name: variantName(model, grouped.generationName, row),
      aliases: [],
      market: "Reference catalog",
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
      evidence: evidence(grouped.rows, fields, "Exact secondary-catalog specification after duplicate source rows were merged. No engine code, horsepower standard, derived kW, sales-market applicability or 30-minute power is inferred."),
      researchNotes: [
        `Merged ${grouped.rows.length} exact legacy source row(s): ${grouped.rows.map((item) => item.id).sort().join(", ")}.`,
        existingModels.has(row.modelId)
          ? `Linked only by a model-specific reviewed rule to ${grouped.generationId}; the source generation spelling remains in provenance.`
          : "Linked to the review-only generation created from the same exact source rows.",
        "Review-only: this specification cannot auto-resolve pricing until its source spelling and generation are separately approved.",
      ],
      updatedAt: "2026-08-17",
    };
  });

  const missingModelVariants = variants.filter((variant) => MISSING_MODEL_IDS.has(variant.modelId));
  const report = {
    schemaVersion: 2,
    generatedAt: "2026-08-17",
    productionConnected: false,
    inputLegacyVariants: legacyVariants.length,
    acceptedSources: sources.length,
    acceptedModels: models.length,
    acceptedGenerations: generations.length,
    acceptedFacelifts: facelifts.length,
    acceptedVariants: variants.length,
    acceptedMissingModelVariants: missingModelVariants.length,
    acceptedExistingGenerationVariants: variants.length - missingModelVariants.length,
    duplicateSourceRowsMerged: sourceRows.length - variants.length,
    rejected,
    policy: {
      japanPriorityWindow: "2015-2026 (overlap required)",
      otherMarketsPriorityWindow: "2020-2026 (overlap required)",
      selectedMissingExactModels: [...MISSING_MODEL_IDS].sort(),
      selectedExistingGenerationRules: [...EXISTING_GENERATION_RULES.keys()].sort(),
      yarisSedanExcludedFromJapanHatchbackGeneration: true,
      regionalWrVGenerationNotGuessed: true,
      ambiguousHybridPowertrainRejected: true,
      engineCodeNotPromoted: true,
      derivedPowerKwNotPromoted: true,
      automaticPublicationReady: false,
    },
    sourceIds: sources.map((source) => source.id),
    modelIds: models.map((model) => model.id),
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
        ...chunks("model", models),
        ...chunks("generation", generations),
        ...chunks("facelift", facelifts),
        ...chunks("variant", variants),
      ],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildDromReviewedGenerationVariantBatch02();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify({
    acceptedSources: report.acceptedSources,
    acceptedModels: report.acceptedModels,
    acceptedGenerations: report.acceptedGenerations,
    acceptedFacelifts: report.acceptedFacelifts,
    acceptedVariants: report.acceptedVariants,
    acceptedMissingModelVariants: report.acceptedMissingModelVariants,
    acceptedExistingGenerationVariants: report.acceptedExistingGenerationVariants,
    duplicateSourceRowsMerged: report.duplicateSourceRowsMerged,
    rejected: report.rejected,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
