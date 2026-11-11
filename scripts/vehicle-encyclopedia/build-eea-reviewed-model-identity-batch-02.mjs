import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, readJson, writeJson } from "./lib.mjs";

const EEA_REPORT = path.join(WORKSPACE_ROOT, "reports/model-eea-europe-2020-2025.json");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-eea-reviewed-identities-02.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-eea-reviewed-identities-02-2026-08-17.json");

function folded(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const definition = (id, canonicalName, patterns, sourceBrandId = id.split("/")[0]) => ({
  id,
  brandId: id.split("/")[0],
  sourceBrandId,
  canonicalName,
  patterns,
});

const DEFINITIONS = [
  definition("alpina/b5", "B5", [/^BMW ALPINA B5\b/]),
  definition("alpina/d5-s", "D5 S", [/^BMW ALPINA D5 S\b/]),
  definition("alpina/xb7", "XB7", [/^BMW ALPINA XB7\b/]),
  definition("alpina/xd3", "XD3", [/^BMW ALPINA XD3\b/]),
  definition("alpina/xd4", "XD4", [/^BMW ALPINA XD4\b/]),
  definition("baic/x75", "X75", [/^X75\b/]),
  definition("borgward/bx7", "BX7", [/^BX7\b/]),
  definition("dfsk/ix5", "ix5", [/^IX5\b/]),
  definition("dfsk/fengon-5", "Fengon 5", [/^FENGON 5\b/]),
  definition("dr-automobiles/f35", "F35", [/^(?:DR )?F35\b/]),
  definition("dr-automobiles/eq1", "DR eQ1", [/^DR EQ1\b/]),
  definition("dr-automobiles/7h", "DR 7H", [/^DR 7H\b/]),
  definition("dr-automobiles/art-e3", "DR ART e3", [/^DR ART E3\b/]),
  definition("ds-automobiles/ds-n-8", "DS N°8", [/^(?:DS )?N 8\b/]),
  definition("ebro/s800", "S800", [/^S800\b/]),
  definition("ebro/s900", "S900", [/^S900\b/]),
  definition("fiat/scudo", "Scudo", [/^(?:FIAT )?SCUDO\b/]),
  definition("ford/tourneo-connect", "Tourneo Connect", [/^(?:GR |GRAND )?TOURNEO CONNECT\b/]),
  definition("forthing/forthing-4", "Forthing 4", [/^FORTHING 4\b/]),
  definition("forthing/forthing-5", "Forthing 5", [/^FORTHING 5\b/]),
  definition("forthing/t5-evo", "T5 EVO", [/^(?:FORTHING )?T5 EVO\b/]),
  definition("forthing/friday", "Friday", [/^FRIDAY\b/]),
  definition("geely/coolray", "Coolray", [/^COOLRAY\b/]),
  definition("geely/cityray", "Cityray", [/^CITYRAY\b/]),
  definition("geely/starray", "Starray", [/^STARRAY\b/]),
  definition("geely/atlas-pro", "Atlas Pro", [/^ATLAS PRO\b/]),
  definition("great-wall/haval-h2w", "Haval H2W", [/^HAVAL H2W\b/]),
  definition("great-wall/wey-coffee-01", "Wey Coffee 01", [/^WEY COFFEE 01\b/]),
  definition("great-wall/wey-coffee-02", "Wey Coffee 02", [/^WEY COFFEE 02\b/]),
  definition("great-wall/wey-05", "Wey 05", [/^WEY 05\b/]),
  definition("hongqi/e-hs9", "E-HS9", [/^HONGQI E HS9\b/], "faw"),
  definition("jac/e30x", "E30X", [/^E30X\b/]),
  definition("jac/e-js4", "E-JS4", [/^E JS4\b/]),
  definition("jac/es4", "ES4", [/^ES4\b/]),
  definition("jac/iev7s", "iEV7S", [/^IEV7S\b/]),
  definition("mazda/6e", "Mazda6e", [/^6E\b/]),
  definition("mg-motor/rx6", "RX6", [/^(?:MG )?(?:MG )?RX6\b/]),
  definition("nio/el7", "EL7", [/^EL7\b/]),
  definition("nio/es8", "ES8", [/^ES8\b/]),
  definition("nissan/nv300", "NV300", [/^(?:NISSAN )?NV300\b/]),
  definition("opel/movano", "Movano", [/^(?:OPEL )?MOVANO\b/]),
  definition("omoda/e5", "E5", [/^E5\b/]),
  definition("polestar/polestar-1", "Polestar 1", [/^(?:POLESTAR )?1\b/]),
  definition("seres/seres-3", "Seres 3", [/^(?:SERES )?3\b/]),
  definition("seres/seres-5", "Seres 5", [/^(?:SERES )?5\b/]),
  definition("sportequipe/ich-x-k3", "ICH-X K3", [/^ICH X K3\b/]),
  definition("sportequipe/x-k2", "X K2", [/^X K2\b/]),
  definition("swm/g01", "G01", [/^G01\b/]),
  definition("swm/g05", "G05", [/^G05\b/]),
  definition("xpeng/g3", "G3", [/^(?:XPENG )?G3\b/]),
];

function datasetIdsForYears(years) {
  const ids = new Set();
  for (const year of years) {
    if (year <= 2022) ids.add("src-eea-co2cars-2020-2022-final");
    else if (year === 2023) ids.add("src-eea-co2cars-2023-final");
    else if (year === 2024) ids.add("src-eea-co2cars-2024-provisional");
    else if (year === 2025) ids.add("src-eea-co2cars-2025-provisional");
  }
  return [...ids].sort();
}

async function loadUnmatched(report) {
  const rows = [];
  for (const file of report.collections.unmatchedCommercialNames || []) {
    const value = await readJson(path.join(WORKSPACE_ROOT, report.reportDirectory, file));
    rows.push(...value.records);
  }
  return rows;
}

export async function buildEeaReviewedModelIdentityBatch02({ verifiedAt = "2026-08-17" } = {}) {
  const [workspace, eea] = await Promise.all([loadWorkspace(), readJson(EEA_REPORT)]);
  const rows = await loadUnmatched(eea);
  const brandIds = new Set(workspace.records.brand.map((brand) => brand.id));
  const existingModels = new Set(workspace.records.model.map((model) => model.id));
  const sourceIds = new Set(workspace.records.source.map((source) => source.id));
  const models = [];
  const reviewed = [];

  for (const item of DEFINITIONS) {
    if (!brandIds.has(item.brandId)) throw new Error(`Missing EEA identity brand: ${item.brandId}`);
    const matched = rows.filter((row) => row.brandId === item.sourceBrandId && item.patterns.some((pattern) => pattern.test(folded(row.commercialName))));
    if (!matched.length) throw new Error(`No official EEA observations for ${item.id}`);
    const evidenceSourceIds = [...new Set(matched.flatMap((row) => datasetIdsForYears(row.years)))].sort();
    for (const sourceId of evidenceSourceIds) {
      if (!sourceIds.has(sourceId)) throw new Error(`Missing EEA source ${sourceId} for ${item.id}`);
    }
    const registrations = matched.reduce((sum, row) => sum + row.registrations, 0);
    const specificationGroups = matched.reduce((sum, row) => sum + row.specificationGroups, 0);
    const years = [...new Set(matched.flatMap((row) => row.years))].sort();
    reviewed.push({
      modelId: item.id,
      canonicalName: item.canonicalName,
      sourceNames: matched.length,
      registrations,
      specificationGroups,
      years,
    });
    if (existingModels.has(item.id)) continue;
    models.push({
      id: item.id,
      brandId: item.brandId,
      canonicalName: item.canonicalName,
      slug: item.id.split("/")[1],
      aliases: [],
      sourceNames: matched.map((row) => ({
        value: row.commercialName,
        kind: "source_spelling",
        safe: false,
        language: "en",
        market: "Europe",
        sourceIds: datasetIdsForYears(row.years),
      })).sort((left, right) => left.value.localeCompare(right.value, "en")),
      productionFrom: null,
      productionTo: null,
      bodyTypes: [],
      powertrainKinds: [],
      mediaIds: [],
      status: "review",
      evidence: evidenceSourceIds.map((sourceId) => ({
        sourceId,
        fields: ["canonicalName"],
        status: "verified",
        confidence: "official",
        note: "Exact same-brand EEA registered commercial-name identity retained after explicit model-boundary review.",
      })),
      researchNotes: [
        `EEA registration observations cover ${years.join(", ")}; ${registrations} registrations and ${specificationGroups} specification groups. Counts establish observed presence, not production boundaries.`,
        "Review status: body style, generation boundary, canonical cover and the complete engine/grade inventory remain pending; source spellings are unsafe until listing-level context confirms the model.",
      ],
      updatedAt: verifiedAt,
    });
  }

  models.sort((left, right) => left.id.localeCompare(right.id, "en"));
  reviewed.sort((left, right) => right.registrations - left.registrations || left.modelId.localeCompare(right.modelId, "en"));
  return {
    report: {
      schemaVersion: 2,
      generatedAt: verifiedAt,
      productionConnected: false,
      policy: {
        officialRegistryObservationRequired: true,
        explicitSameBrandBoundaryRequired: true,
        sourceSpellingsUnsafeByDefault: true,
        productionYearsNotInferred: true,
        automaticPublicationReady: false,
      },
      totals: {
        reviewedDefinitions: DEFINITIONS.length,
        newModels: models.length,
        registrations: reviewed.reduce((sum, row) => sum + row.registrations, 0),
      },
      reviewed,
    },
    ingestion: {
      schemaVersion: 2,
      batches: [{ schemaVersion: 2, entityType: "model", chunk: 1, maxRecords: 250, records: models }],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildEeaReviewedModelIdentityBatch02();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
