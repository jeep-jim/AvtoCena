import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, readJson, writeJson } from "./lib.mjs";

const EEA_REPORT = path.join(WORKSPACE_ROOT, "reports/model-eea-europe-2020-2025.json");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/brand-eea-registered-make-expansion.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/brand-registry-eea-make-expansion-02-2026-08-17.json");

const REVIEWED_MAKES = [
  { id: "brabus", canonicalName: "Brabus", rawMakes: ["BRABUS"] },
  { id: "bugatti", canonicalName: "Bugatti", rawMakes: ["BUGATTI"] },
  { id: "cirelli", canonicalName: "Cirelli", rawMakes: ["CIRELLI"] },
  { id: "dallara", canonicalName: "Dallara", rawMakes: ["DALLARA"] },
  { id: "donkervoort", canonicalName: "Donkervoort", rawMakes: ["DONKERVOORT"] },
  { id: "ego-mobile", canonicalName: "e.GO", rawMakes: ["E.GO", "EGO"] },
  { id: "elaris", canonicalName: "Elaris", rawMakes: ["ELARIS"] },
  { id: "exlantix", canonicalName: "Exlantix", rawMakes: ["EXLANTIX"] },
  { id: "ktm", canonicalName: "KTM", rawMakes: ["KTM"] },
  { id: "mobilize", canonicalName: "Mobilize", rawMakes: ["MOBILIZE"] },
  { id: "moke", canonicalName: "Moke", rawMakes: ["MOKE"] },
  { id: "ruf", canonicalName: "RUF", rawMakes: ["RUF"] },
  { id: "secma", canonicalName: "SECMA", rawMakes: ["SECMA"] },
  { id: "suda", canonicalName: "Suda", rawMakes: ["SUDA"] },
  { id: "togg", canonicalName: "Togg", rawMakes: ["TOGG"] },
  { id: "yudo", canonicalName: "Yudo", rawMakes: ["YUDO"] },
  { id: "zhidou", canonicalName: "Zhidou", rawMakes: ["ZHIDOU"] }
];

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function chunk(entityType, records) {
  return Array.from({ length: Math.ceil(records.length / 250) }, (_, index) => ({
    schemaVersion: 2,
    entityType,
    chunk: index + 1,
    maxRecords: 250,
    records: records.slice(index * 250, (index + 1) * 250)
  }));
}

export async function buildEeaRegisteredMakeBrandBatch({ verifiedAt = "2026-08-17" } = {}) {
  const [workspace, eea] = await Promise.all([loadWorkspace(), readJson(EEA_REPORT)]);
  const existing = new Set(workspace.records.brand.map((brand) => brand.id));
  const unresolved = new Map((eea.unresolvedRawMakes || []).map((row) => [row.rawMake.toLocaleUpperCase("en"), row]));
  const brands = [];
  const observations = [];

  for (const reviewed of REVIEWED_MAKES) {
    if (existing.has(reviewed.id)) continue;
    const rows = reviewed.rawMakes.map((rawMake) => unresolved.get(rawMake.toLocaleUpperCase("en"))).filter(Boolean);
    if (!rows.length) throw new Error(`No unresolved EEA make observation remains for ${reviewed.canonicalName}`);
    const years = [...new Set(rows.flatMap((row) => row.years || []))].sort((left, right) => left - right);
    const sourceIds = sourceIdsForYears(years);
    const aliases = rows
      .map((row) => row.rawMake)
      .filter((value) => value.toLocaleLowerCase("en") !== reviewed.canonicalName.toLocaleLowerCase("en"))
      .map((value) => ({ value, kind: "source_spelling", safe: true, language: "en", market: "Europe", sourceIds: sourceIdsForYears(rows.find((row) => row.rawMake === value)?.years || []) }));
    brands.push({
      id: reviewed.id,
      canonicalName: reviewed.canonicalName,
      slug: slugify(reviewed.canonicalName),
      aliases,
      countries: [],
      status: "seed",
      evidence: [{
        sourceId: sourceIds[0],
        fields: ["canonicalName"],
        status: "verified",
        confidence: "official",
        note: `${rows.map((row) => row.rawMake).join(" and ")} are exact registered make values in the EEA passenger-car datasets.`
      }],
      researchNotes: [
        `EEA observations cover ${years.join(", ")} and ${rows.reduce((sum, row) => sum + (row.registrations || 0), 0)} registrations. Authentic source-traceable 90 x 60 dark/light logos and complete in-window model coverage remain required.`,
        "This reviewed make is retained as an automotive marque; coachbuilder, motorhome, converter, address-only and cross-brand make strings remain unresolved."
      ],
      updatedAt: verifiedAt
    });
    observations.push({ id: reviewed.id, canonicalName: reviewed.canonicalName, rawMakes: rows.map((row) => row.rawMake), years, registrations: rows.reduce((sum, row) => sum + (row.registrations || 0), 0) });
  }

  brands.sort((left, right) => left.id.localeCompare(right.id, "en"));
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    policy: {
      exactEeaRegisteredMakesOnly: true,
      independentAutomotiveMarquesOnly: true,
      coachbuildersAndMotorhomesExcluded: true,
      convertersAndAddressStringsExcluded: true,
      crossBrandStringsExcluded: true,
      publicationGateRequired: true
    },
    totals: {
      reviewedDefinitions: REVIEWED_MAKES.length,
      newBrands: brands.length,
      observedRegistrations: observations.reduce((sum, row) => sum + row.registrations, 0)
    },
    observations
  };
  return { report, ingestion: { schemaVersion: 2, batches: chunk("brand", brands) } };
}

async function main() {
  const { report, ingestion } = await buildEeaRegisteredMakeBrandBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
