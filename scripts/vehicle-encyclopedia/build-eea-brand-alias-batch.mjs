import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const EEA_REPORT = path.join(WORKSPACE_ROOT, "reports/model-eea-europe-2020-2025.json");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/brand-eea-safe-aliases.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/brands-eea-safe-aliases-2026-08-17.json");

const REVIEWED_SOURCE_ALIASES = new Map([
  ["MERCEDES", { brandId: "mercedes-benz", reason: "EEA source spelling omits the second half of the canonical Mercedes-Benz marque" }],
  ["MERCEDES-AMG", { brandId: "mercedes-benz", reason: "Mercedes-AMG is the performance sub-brand retained under the canonical Mercedes-Benz marque" }],
  ["BMW I", { brandId: "bmw", reason: "BMW i is the electrified BMW sub-brand retained under the canonical BMW marque" }],
  ["MITSUBISHI MOTORS THAILAND", { brandId: "mitsubishi", reason: "the EEA make value adds the manufacturer subsidiary and country to the Mitsubishi marque" }],
  ["KG MOBILITY", { brandId: "kgm", reason: "KG Mobility is the company/source spelling for the public KGM vehicle brand", extraSourceIds: ["src-kgm-actyon-global-2024"] }],
  ["MITSUBISHI MOTORS CORPORATION", { brandId: "mitsubishi", reason: "the EEA make value is the manufacturer company name for the Mitsubishi marque" }],
  ["MITSUBISHI MOTORS THAILAND LTD.", { brandId: "mitsubishi", reason: "the EEA make value adds the manufacturer subsidiary and legal suffix to the Mitsubishi marque" }],
  ["GREAT WALL MOTOR CO. LTD.", { brandId: "great-wall", reason: "the EEA make value is the manufacturer company name for the Great Wall marque" }],
  ["GREAT WALL MOTOR CO LTD", { brandId: "great-wall", reason: "the EEA make value is the manufacturer company name for the Great Wall marque" }],
  ["GREAT WALL MOTOR COMPANY LIMITED", { brandId: "great-wall", reason: "the EEA make value is the manufacturer company name for the Great Wall marque" }],
  ["GREAT WALL MOTOR COMPANY", { brandId: "great-wall", reason: "the EEA make value is the manufacturer company name for the Great Wall marque" }],
  ["AUTOMOBILI LAMBORGHINI", { brandId: "lamborghini", reason: "the EEA make value is the manufacturer company wording for the Lamborghini marque" }],
  ["AUTOMOBILI LAMBORGHINI SPA", { brandId: "lamborghini", reason: "the EEA make value adds the manufacturer legal suffix to the Lamborghini marque" }],
  ["AUTOMOBILI LAMBORGHINI S.P.A.", { brandId: "lamborghini", reason: "the EEA make value adds the manufacturer legal suffix to the Lamborghini marque" }],
  ["LUCID MOTORS", { brandId: "lucid", reason: "the EEA make value adds the manufacturer company term to the Lucid marque" }],
  ["LUCID USA INC", { brandId: "lucid", reason: "the EEA make value is the manufacturer company spelling for the Lucid marque" }],
  ["NISSAN AUTOMOTIVE EUROPE", { brandId: "nissan", reason: "the EEA make value is the regional manufacturer company spelling for the Nissan marque" }],
  ["MCC SMART", { brandId: "smart", reason: "MCC smart is the historical manufacturer/source spelling for the smart marque" }],
  ["FORD-CNG TECHNIK", { brandId: "ford", reason: "the EEA make value identifies Ford vehicles through the named CNG conversion manufacturer" }],
  ["FORD-CNG-TECHNIK", { brandId: "ford", reason: "the EEA make value identifies Ford vehicles through the named CNG conversion manufacturer" }],
]);

function chunk(entityType, records) {
  return Array.from({ length: Math.ceil(records.length / 250) }, (_, index) => ({
    schemaVersion: 2,
    entityType,
    chunk: index + 1,
    maxRecords: 250,
    records: records.slice(index * 250, (index + 1) * 250),
  }));
}

function sourceIdsForYears(years) {
  const ids = new Set();
  for (const year of years) {
    if (year <= 2022) ids.add("src-eea-co2cars-2020-2022-final");
    else if (year === 2023) ids.add("src-eea-co2cars-2023-final");
    else if (year === 2024) ids.add("src-eea-co2cars-2024-provisional");
    else if (year === 2025) ids.add("src-eea-co2cars-2025-provisional");
  }
  return [...ids].sort();
}

function canSegment(value, terms, maxParts = 4) {
  const memo = new Map();
  function walk(offset, parts) {
    const key = `${offset}:${parts}`;
    if (memo.has(key)) return memo.get(key);
    if (offset === value.length) return parts >= 2;
    if (parts >= maxParts) return false;
    const matched = terms.some((term) => value.startsWith(term, offset) && walk(offset + term.length, parts + 1));
    memo.set(key, matched);
    return matched;
  }
  return walk(0, 0);
}

export async function buildEeaBrandAliasBatch({ verifiedAt = "2026-08-17" } = {}) {
  const [workspace, eea] = await Promise.all([loadWorkspace(), readJson(EEA_REPORT)]);
  const termsByBrand = new Map(workspace.records.brand.map((brand) => [brand.id, [...new Set([
    brand.id,
    brand.canonicalName,
    ...(brand.aliases || []).filter((alias) => alias.safe).map((alias) => alias.value),
  ].map(normalizeTerm).filter((term) => term.length >= 2))].sort((left, right) => right.length - left.length)]));

  const accepted = [];
  const ambiguous = [];
  for (const unresolved of eea.unresolvedRawMakes || []) {
    const reviewed = REVIEWED_SOURCE_ALIASES.get(unresolved.rawMake.toLocaleUpperCase("en"));
    if (reviewed) {
      const brand = workspace.records.brand.find((row) => row.id === reviewed.brandId);
      if (!brand) throw new Error(`Missing reviewed alias target ${reviewed.brandId}`);
      accepted.push({
        brandId: brand.id,
        brand: brand.canonicalName,
        rawMake: unresolved.rawMake,
        years: unresolved.years,
        registrations: unresolved.registrations,
        sourceIds: [...new Set([...sourceIdsForYears(unresolved.years), ...(reviewed.extraSourceIds || [])])].sort(),
        rule: reviewed.reason,
      });
      continue;
    }
    const normalized = normalizeTerm(unresolved.rawMake);
    if (normalized.length < 3 || normalized.length > 100) continue;
    const matches = workspace.records.brand.filter((brand) => canSegment(normalized, termsByBrand.get(brand.id)));
    if (matches.length === 1) {
      accepted.push({
        brandId: matches[0].id,
        brand: matches[0].canonicalName,
        rawMake: unresolved.rawMake,
        years: unresolved.years,
        registrations: unresolved.registrations,
        sourceIds: sourceIdsForYears(unresolved.years),
        rule: "the complete normalized raw make is composed only of two to four already-safe aliases of one canonical brand",
      });
    } else if (matches.length > 1) {
      ambiguous.push({ rawMake: unresolved.rawMake, brandIds: matches.map((brand) => brand.id).sort(), registrations: unresolved.registrations });
    }
  }

  const updatedBrands = [];
  for (const brand of workspace.records.brand) {
    const rows = accepted.filter((row) => row.brandId === brand.id);
    if (!rows.length) continue;
    const aliases = [...(brand.aliases || [])];
    const seen = new Set([brand.canonicalName, ...aliases.map((alias) => alias.value)].map(normalizeTerm));
    for (const row of rows.sort((left, right) => left.rawMake.localeCompare(right.rawMake, "en"))) {
      if (seen.has(normalizeTerm(row.rawMake))) continue;
      seen.add(normalizeTerm(row.rawMake));
      aliases.push({
        value: row.rawMake,
        kind: "source_spelling",
        safe: true,
        language: "en",
        market: "Europe",
        sourceIds: row.sourceIds,
      });
    }
    if (aliases.length !== (brand.aliases || []).length) updatedBrands.push({ ...brand, aliases, updatedAt: verifiedAt });
  }
  const updatedById = new Map(updatedBrands.map((brand) => [brand.id, brand]));
  const snapshotBrands = workspace.records.brand
    .map((brand) => updatedById.get(brand.id) || brand)
    .filter((brand) => (brand.aliases || []).some((alias) => (alias.sourceIds || []).some((sourceId) => sourceId.startsWith("src-eea-co2cars-"))))
    .sort((left, right) => left.id.localeCompare(right.id, "en"));

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    policy: {
      exactFullStringSegmentationRequired: true,
      knownSafeSameBrandTermsOnly: true,
      crossBrandCompositesRejected: true,
      reviewedSourceAliasOverrides: REVIEWED_SOURCE_ALIASES.size,
      maximumSegments: 4,
      safeAutomaticBrandResolution: true,
    },
    totals: {
      unresolvedEeaRawMakesReviewed: eea.unresolvedRawMakes?.length || 0,
      acceptedSafeAliases: accepted.length,
      brandsUpdated: updatedBrands.length,
      stagedBrandsWithEeaAliases: snapshotBrands.length,
      ambiguousAliases: ambiguous.length,
    },
    accepted: accepted.sort((left, right) => right.registrations - left.registrations || left.rawMake.localeCompare(right.rawMake, "en")),
    ambiguous,
  };
  const ingestion = { schemaVersion: 2, batches: chunk("brand", snapshotBrands) };
  return { report, ingestion };
}

async function main() {
  const { report, ingestion } = await buildEeaBrandAliasBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
