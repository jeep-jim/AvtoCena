import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/audi-china-e7x-official-2026.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/audi-china-e7x-official-2026-08-17.json");
const SOURCE_ID = "src-audi-china-e7x-production-2026";

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(fields, note) {
  return [{ sourceId: SOURCE_ID, fields, status: "verified", confidence: "official", note }];
}

export async function buildAudiChinaE7xBatch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existing = Object.fromEntries(["source", "model", "generation", "variant"]
    .map((type) => [type, new Set(workspace.records[type].map((record) => record.id))]));
  const sources = existing.source.has(SOURCE_ID) ? [] : [{
    id: SOURCE_ID,
    type: "manufacturer",
    title: "AUDI E7X: China-exclusive sister brand presents its first SUV",
    publisher: "AUDI AG",
    url: "https://www.audi.com/de/pressemitteilungen/audi-e7x-china-exklusive-schwestermarke-stellt-ihren-ersten-suv-vor-17100",
    documentId: null,
    documentDate: "2026-04-24",
    verifiedAt,
    market: "China",
    language: "de",
    supportedFields: [
      "canonicalName", "name", "productionFrom", "bodyTypes", "powertrainKinds", "platformCodes",
      "market", "yearFrom", "bodyType", "powertrainKind", "drive", "powerKw", "lengthMm", "widthMm",
      "heightMm", "wheelbaseMm", "zeroTo100Sec",
    ],
    confidence: "official",
    status: "active",
    license: null,
    notes: "Latest official production release supersedes the 2025 preview dimensions. The two power/drive versions are explicit; 100/109 kWh battery sizes and four/five-seat layouts are not paired to a drivetrain and are therefore not assigned to these variants.",
  }];
  const models = existing.model.has("audi-china/e7x") ? [] : [{
    id: "audi-china/e7x",
    brandId: "audi-china",
    canonicalName: "E7X",
    slug: "e7x",
    aliases: [],
    sourceNames: [],
    productionFrom: "2026",
    productionTo: null,
    bodyTypes: ["SUV"],
    powertrainKinds: ["BEV"],
    mediaIds: [],
    status: "review",
    evidence: evidence(["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds"], "AUDI AG explicitly identifies E7X as the second production model of the China-only AUDI brand, an all-electric SUV entering the market in 2026."),
    researchNotes: [
      "Review-only until the AUDI China identity, exact logo and canonical cover pass publication review.",
      "The announced third AUDI model for 2027 is not added because no production model name is published.",
    ],
    updatedAt: verifiedAt,
  }];
  const generations = existing.generation.has("audi-china/e7x/adp") ? [] : [{
    id: "audi-china/e7x/adp",
    modelId: "audi-china/e7x",
    name: "ADP",
    aliases: [],
    platformCodes: ["ADP"],
    productionFrom: "2026",
    productionTo: null,
    bodyTypes: ["SUV"],
    status: "review",
    evidence: evidence(["name", "platformCodes", "productionFrom", "bodyTypes"], "The production release explicitly identifies the E7X Advanced Digitized Platform and 2026 market introduction."),
    researchNotes: ["Review-only first published E7X production specification; no later generation boundary is inferred."],
    updatedAt: verifiedAt,
  }];
  const definitions = [
    { id: "300-kw-rwd", name: "300 kW RWD", drive: "RWD", powerKw: 300 },
    { id: "500-kw-quattro", name: "500 kW quattro", drive: "AWD", powerKw: 500, zeroTo100Sec: 3.9 },
  ];
  const variants = definitions.filter((definition) => !existing.variant.has(`audi-china/e7x/adp/${definition.id}`)).map((definition) => {
    const fields = ["name", "market", "yearFrom", "bodyType", "powertrainKind", "drive", "powerKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm"];
    if (definition.zeroTo100Sec) fields.push("zeroTo100Sec");
    return {
      id: `audi-china/e7x/adp/${definition.id}`,
      modelId: "audi-china/e7x",
      generationId: "audi-china/e7x/adp",
      faceliftId: null,
      name: definition.name,
      aliases: [],
      market: "China",
      yearFrom: 2026,
      yearTo: null,
      bodyType: "SUV",
      powertrainKind: "BEV",
      drive: definition.drive,
      powerKw: definition.powerKw,
      lengthMm: 5049,
      widthMm: 1997,
      heightMm: 1710,
      wheelbaseMm: 3060,
      ...(definition.zeroTo100Sec ? { zeroTo100Sec: definition.zeroTo100Sec } : {}),
      status: "review",
      evidence: evidence(fields, "Exact final production-release values. quattro is normalized to AWD; no battery, range, seat count, charging power or 30-minute power is assigned because the release does not bind those values to this drivetrain row."),
      researchNotes: [
        "Review-only exact manufacturer specification; production pricing remains disconnected.",
        "The 2025 preview dimensions were not retained because the later April 2026 production release provides revised values.",
      ],
      updatedAt: verifiedAt,
    };
  });
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { newSources: sources.length, newModels: models.length, newGenerations: generations.length, newVariants: variants.length },
    sourceIds: sources.map((source) => source.id),
    modelIds: models.map((model) => model.id),
    generationIds: generations.map((generation) => generation.id),
    variantIds: variants.map((variant) => variant.id),
    policy: {
      latestProductionReleaseWins: true,
      unpairedBatteryAndSeatingValuesRejected: true,
      promotionalRangeNotPromoted: true,
      power30MinNotDerived: true,
      automaticPublicationReady: false,
    },
  };
  return {
    report,
    ingestion: {
      schemaVersion: 2,
      batches: [
        ...(sources.length ? [chunk("source", sources)] : []),
        ...(models.length ? [chunk("model", models)] : []),
        ...(generations.length ? [chunk("generation", generations)] : []),
        ...(variants.length ? [chunk("variant", variants)] : []),
      ],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildAudiChinaE7xBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
