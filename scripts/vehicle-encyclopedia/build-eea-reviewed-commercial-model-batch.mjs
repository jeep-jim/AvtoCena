import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const EEA_REPORT_DIR = path.join(WORKSPACE_ROOT, "reports/model-eea-europe-2020-2025");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-eea-reviewed-commercial-models.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-eea-reviewed-commercial-2026-08-17.json");

const OFFICIAL_SOURCES = [
  {
    id: "src-dr-current-range-2026",
    type: "manufacturer",
    title: "DR current model range",
    publisher: "DR Automobiles",
    url: "https://drautomobiles.com/concessionarie/",
    documentId: null,
    documentDate: null,
    verifiedAt: "2026-08-17",
    market: "Europe",
    language: "it",
    supportedFields: ["canonicalName"],
    confidence: "official",
    status: "active",
    license: null,
    notes: "The official DR range lists DR 1.0 EV, DR 3, DR 5, DR 6.0, DR 6.0 powertrain versions, DR 7.0 PHEV and DR PK8. Model-level records keep powertrain labels below the canonical model boundary."
  },
  {
    id: "src-sportequipe-current-technical-range-2026",
    type: "manufacturer_technical_document",
    title: "Sportequipe current technical range",
    publisher: "Sportequipe",
    url: "https://sportequipe.it/modelli/caratteristiche-tecniche/",
    documentId: null,
    documentDate: null,
    verifiedAt: "2026-08-17",
    market: "Europe",
    language: "it",
    supportedFields: ["canonicalName"],
    confidence: "official",
    status: "active",
    license: null,
    notes: "Official Sportequipe technical pages identify the numbered model range. Exact engines, bodies and trims remain separate generation/variant work."
  },
  {
    id: "src-mahindra-europe-kuv100-xuv500-2018",
    type: "manufacturer",
    title: "Mahindra presents KUV100 and XUV500 in Bulgaria",
    publisher: "Mahindra Motors",
    url: "https://www.mahindra.it/mahindra-presenta-il-proprio-brand-in-bulgaria/",
    documentId: null,
    documentDate: "2018-09-27",
    verifiedAt: "2026-08-17",
    market: "Europe",
    language: "it",
    supportedFields: ["canonicalName"],
    confidence: "official",
    status: "active",
    license: null,
    notes: "Mahindra's official European-market announcement identifies KUV100 and XUV500; EEA registrations independently establish in-window 2020-2025 observations."
  },
  {
    id: "src-man-tge-current-model-2026",
    type: "manufacturer_technical_document",
    title: "MAN TGE current model overview",
    publisher: "MAN Truck & Bus",
    url: "https://www.man.eu/de/de/transporter/man-tge/kastenwagen/man-tge-kastenwagen.html",
    documentId: null,
    documentDate: null,
    verifiedAt: "2026-08-17",
    market: "Europe",
    language: "de",
    supportedFields: ["canonicalName"],
    confidence: "official",
    status: "active",
    license: null,
    notes: "The official MAN page identifies TGE and its body derivatives. The canonical model remains TGE; body and gross-weight versions are not promoted to separate models."
  }
];

const REVIEWED_MODELS = [
  { brandId: "audi", canonicalName: "A4", sourceNames: ["A4 AVANT", "A4 LIMOUSINE", "A4 ALLROAD QUATTRO"], officialSourceId: null },
  { brandId: "bmw", canonicalName: "1 Series", sourceNames: ["118I", "118 D", "116D", "116I", "120", "120I", "120D", "SERIE 1", "M135I XDRIVE"], officialSourceId: null },
  { brandId: "bmw", canonicalName: "3 Series", sourceNames: ["320D", "330 E", "320D XDRIVE", "318D", "330 E XDRIVE", "318I", "320I", "320E", "330 D XDRIVE", "330I"], officialSourceId: null },
  { brandId: "bugatti", canonicalName: "Centodieci", sourceNames: ["BUGATTI CENTODIECI"], officialSourceId: null },
  { brandId: "citroen", canonicalName: "Berlingo", sourceNames: ["BERLINGO"], officialSourceId: null },
  { brandId: "cirelli", canonicalName: "1", sourceNames: ["CIRELLI 1", "CIRELLI 1 CROSS"], officialSourceId: null },
  { brandId: "cirelli", canonicalName: "2", sourceNames: ["CIRELLI 2", "CIRELLI 2 CROSS"], officialSourceId: null },
  { brandId: "cirelli", canonicalName: "3", sourceNames: ["CIRELLI 3", "CIRELLI 3 SPORT"], officialSourceId: null },
  { brandId: "cirelli", canonicalName: "4", sourceNames: ["CIRELLI 4", "CIRELLI 4 CROSS", "CIRELLI 4 PLUG-IN"], officialSourceId: null },
  { brandId: "cirelli", canonicalName: "5", sourceNames: ["CIRELLI 5", "CIRELLI 5 BIFUEL", "CIRELLI 5 BIFUEL CROSS", "CIRELLI 5 CROSS", "CIRELLI 5 SPORT"], officialSourceId: null },
  { brandId: "cirelli", canonicalName: "7", sourceNames: ["CIRELLI 7", "CIRELLI 7 BIFUEL", "CIRELLI 7 BIFUEL CROSS", "CIRELLI 7 CROSS"], officialSourceId: null },
  { brandId: "cirelli", canonicalName: "Sport Coupe", sourceNames: ["CIRELLI SPORT COUPE'"], officialSourceId: null },
  { brandId: "dallara", canonicalName: "Stradale", sourceNames: ["DALLARA STRADALE", "STRADALE"], officialSourceId: null },
  { brandId: "donkervoort", canonicalName: "GTO", sourceNames: ["GTO-JD70", "GTO-INDIVIDUAL", "GTO-INDIVIDUAL SERIES"], officialSourceId: null },
  { brandId: "dacia", canonicalName: "Dokker", sourceNames: ["DOKKER"], officialSourceId: null },
  { brandId: "dacia", canonicalName: "Lodgy", sourceNames: ["LODGY"], officialSourceId: null },
  { brandId: "ds-automobiles", canonicalName: "DS 4", sourceNames: ["DS4"], officialSourceId: null },
  { brandId: "dr-automobiles", canonicalName: "1.0 EV", sourceNames: [], officialSourceId: "src-dr-current-range-2026" },
  { brandId: "dr-automobiles", canonicalName: "3.0", sourceNames: ["DR 30", "DR3"], officialSourceId: "src-dr-current-range-2026" },
  { brandId: "dr-automobiles", canonicalName: "4.0", sourceNames: ["DR 4.0", "DR4"], officialSourceId: null },
  { brandId: "dr-automobiles", canonicalName: "5.0", sourceNames: ["DR 50", "DR 5"], officialSourceId: "src-dr-current-range-2026" },
  { brandId: "dr-automobiles", canonicalName: "6.0", sourceNames: ["DR 6.0", "DR6"], officialSourceId: "src-dr-current-range-2026" },
  { brandId: "dr-automobiles", canonicalName: "7.0 PHEV", sourceNames: ["DR7.0"], officialSourceId: "src-dr-current-range-2026" },
  { brandId: "dr-automobiles", canonicalName: "PK8", sourceNames: [], officialSourceId: "src-dr-current-range-2026" },
  { brandId: "emc", canonicalName: "Wave 2", sourceNames: ["WAVE 2"], officialSourceId: null },
  { brandId: "emc", canonicalName: "Wave 3", sourceNames: ["WAVE 3", "WAVE 3 GPL"], officialSourceId: null },
  { brandId: "emc", canonicalName: "Quattro", sourceNames: ["EMC QUATTRO"], officialSourceId: null },
  { brandId: "emc", canonicalName: "Sei", sourceNames: ["EMC SEI"], officialSourceId: null },
  { brandId: "emc", canonicalName: "Sette", sourceNames: ["EMC SETTE"], officialSourceId: null },
  { brandId: "evo", canonicalName: "3", sourceNames: ["EVO3", "EVO 3"], officialSourceId: null, sourceBrandIds: ["dr-automobiles", "evo"] },
  { brandId: "evo", canonicalName: "4", sourceNames: ["EVO4", "EVO 4", "EVO CUATRO"], officialSourceId: null, sourceBrandIds: ["dr-automobiles", "evo"] },
  { brandId: "evo", canonicalName: "5", sourceNames: ["EVO5", "EVO 5"], officialSourceId: null, sourceBrandIds: ["dr-automobiles", "evo"] },
  { brandId: "evo", canonicalName: "6", sourceNames: ["EVO6", "EVO 6"], officialSourceId: null, sourceBrandIds: ["dr-automobiles", "evo"] },
  { brandId: "evo", canonicalName: "7", sourceNames: ["EVO7", "EVO 7", "EVO7 SPORT"], officialSourceId: null, sourceBrandIds: ["dr-automobiles", "evo"] },
  { brandId: "evo", canonicalName: "Spazio", sourceNames: ["EVO SPAZIO"], officialSourceId: null },
  { brandId: "ego-mobile", canonicalName: "e.wave X", sourceNames: ["E.WAVE X"], officialSourceId: null },
  { brandId: "elaris", canonicalName: "Pio", sourceNames: ["ELARIS PIO"], officialSourceId: null },
  { brandId: "exlantix", canonicalName: "ES", sourceNames: ["ES", "EXLANTIX ES"], officialSourceId: null },
  { brandId: "exlantix", canonicalName: "ET", sourceNames: ["ET"], officialSourceId: null },
  { brandId: "ford", canonicalName: "Transit", sourceNames: ["TRANSIT"], officialSourceId: null },
  { brandId: "ford", canonicalName: "Transit Custom", sourceNames: ["TRANSIT CUSTOM"], officialSourceId: null },
  { brandId: "honda", canonicalName: "HR-V", sourceNames: ["HRV"], officialSourceId: null },
  { brandId: "kia", canonicalName: "Sportage", sourceNames: ["SPORTAGE"], officialSourceId: null },
  { brandId: "mahindra", canonicalName: "KUV100 NXT", sourceNames: ["MAHINDRA KUV 100 NXT", "KUV 100", "KUV 100 NXT", "KUV 100 NXT LPG"], officialSourceId: "src-mahindra-europe-kuv100-xuv500-2018" },
  { brandId: "mahindra", canonicalName: "XUV500", sourceNames: ["MAHINDRA XUV 500"], officialSourceId: "src-mahindra-europe-kuv100-xuv500-2018" },
  { brandId: "man", canonicalName: "TGE", sourceNames: ["TGE", "MAN TGE L2H2", "TGE 3.140", "TGE 3.180 4X4 SB", "TGE PMR"], officialSourceId: "src-man-tge-current-model-2026" },
  { brandId: "mazda", canonicalName: "CX-5", sourceNames: ["MAZDA CX 5", "CX 5"], officialSourceId: null },
  { brandId: "mercedes-benz", canonicalName: "A-Class", sourceNames: ["A 250 E", "A 180", "A 180 D", "A 200", "A 200 D", "A 160"], officialSourceId: null },
  { brandId: "mercedes-benz", canonicalName: "B-Class", sourceNames: ["B 180", "B 200", "B 180 D", "B 250E", "B 200 D"], officialSourceId: null },
  { brandId: "mercedes-benz", canonicalName: "C-Class", sourceNames: ["C 220 D", "C 300 E", "C 180", "C 200 D", "C 200", "C 300 DE", "C 220 D 4MATIC", "C 300 D"], officialSourceId: null },
  { brandId: "mercedes-benz", canonicalName: "Citan", sourceNames: ["CITAN"], officialSourceId: null },
  { brandId: "mercedes-benz", canonicalName: "Sprinter", sourceNames: ["SPRINTER"], officialSourceId: null },
  { brandId: "mini", canonicalName: "One", sourceNames: ["ONE"], officialSourceId: null },
  { brandId: "mobilize", canonicalName: "Limo", sourceNames: ["LIMO"], officialSourceId: null },
  { brandId: "moke", canonicalName: "Moke", sourceNames: ["MOKE", "INTERNATIONAL LIMITED MOKE"], officialSourceId: null },
  { brandId: "nissan", canonicalName: "Qashqai", sourceNames: ["NISSAN QASHQAI", "QASHQAI"], officialSourceId: null },
  { brandId: "nissan", canonicalName: "Townstar", sourceNames: ["TOWNSTAR"], officialSourceId: null },
  { brandId: "nissan", canonicalName: "X-Trail", sourceNames: ["NISSAN X-TRAIL", "X TRAIL"], officialSourceId: null },
  { brandId: "opel", canonicalName: "Combo", sourceNames: ["COMBO LIFE"], officialSourceId: null },
  { brandId: "peugeot", canonicalName: "Expert", sourceNames: ["EXPERT"], officialSourceId: null },
  { brandId: "peugeot", canonicalName: "Rifter", sourceNames: ["RIFTER"], officialSourceId: null },
  { brandId: "renault", canonicalName: "Kangoo", sourceNames: ["KANGOO"], officialSourceId: null },
  { brandId: "renault", canonicalName: "Trafic", sourceNames: ["TRAFIC"], officialSourceId: null },
  { brandId: "ruf", canonicalName: "CTR Anniversary", sourceNames: ["CTR ANNIVERSARY"], officialSourceId: null },
  { brandId: "ruf", canonicalName: "Rodeo", sourceNames: ["RODEO"], officialSourceId: null },
  { brandId: "ruf", canonicalName: "SCR", sourceNames: ["SCR"], officialSourceId: null },
  { brandId: "secma", canonicalName: "Fun 1600", sourceNames: ["FUN 1600", "FUN 1600 BUGGY", "FUN 1600 TURBO", "FUN 1600 TURBO GT"], officialSourceId: null },
  { brandId: "suda", canonicalName: "SA01", sourceNames: ["SUDA SA01"], officialSourceId: null },
  { brandId: "sportequipe", canonicalName: "5", sourceNames: ["SPORTEQUIPE 5"], officialSourceId: "src-sportequipe-current-technical-range-2026", sourceBrandIds: ["dr-automobiles", "sportequipe"] },
  { brandId: "sportequipe", canonicalName: "6", sourceNames: ["SPORTEQUIPE 6", "SPORTEQUIPE 6H"], officialSourceId: "src-sportequipe-current-technical-range-2026", sourceBrandIds: ["dr-automobiles", "sportequipe"] },
  { brandId: "sportequipe", canonicalName: "7", sourceNames: ["SPORTEQUIPE 7", "SPORTEQUIPE 7 GTW"], officialSourceId: "src-sportequipe-current-technical-range-2026", sourceBrandIds: ["dr-automobiles", "sportequipe"] },
  { brandId: "sportequipe", canonicalName: "8", sourceNames: ["SPORTEQUIPE 8", "SPORTEQUIPE 8H"], officialSourceId: "src-sportequipe-current-technical-range-2026" },
  { brandId: "togg", canonicalName: "T10F", sourceNames: ["T10F"], officialSourceId: null },
  { brandId: "toyota", canonicalName: "Camry", sourceNames: ["TOYOTA CAMRY"], officialSourceId: null },
  { brandId: "toyota", canonicalName: "Proace", sourceNames: ["PROACE"], officialSourceId: null },
  { brandId: "toyota", canonicalName: "Proace City Verso", sourceNames: ["Proace City Verso"], officialSourceId: null },
  { brandId: "volkswagen", canonicalName: "Caddy", sourceNames: ["CADDY"], officialSourceId: null },
  { brandId: "volkswagen", canonicalName: "Multivan", sourceNames: ["MULTIVAN"], officialSourceId: null },
  { brandId: "volkswagen", canonicalName: "T-Cross", sourceNames: ["T CROSS"], officialSourceId: null },
  { brandId: "volkswagen", canonicalName: "Touareg", sourceNames: ["TOUAREG"], officialSourceId: null },
  { brandId: "yudo", canonicalName: "3", sourceNames: ["YUDO 3"], officialSourceId: null }
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

async function loadUnmatchedRows() {
  const files = (await readdir(EEA_REPORT_DIR)).filter((file) => /^unmatched-commercial-names-\d+\.json$/.test(file)).sort();
  const rows = [];
  for (const file of files) rows.push(...(await readJson(path.join(EEA_REPORT_DIR, file))).records);
  return rows;
}

export async function buildEeaReviewedCommercialModelBatch({ verifiedAt = "2026-08-17" } = {}) {
  const [workspace, unmatchedRows] = await Promise.all([loadWorkspace(), loadUnmatchedRows()]);
  const brandById = new Map(workspace.records.brand.map((brand) => [brand.id, brand]));
  const existingModels = new Set(workspace.records.model.map((model) => model.id));
  const records = [];
  const reviewRows = [];

  for (const review of REVIEWED_MODELS) {
    const brand = brandById.get(review.brandId);
    if (!brand) throw new Error(`Missing reviewed brand ${review.brandId}`);
    const id = `${review.brandId}/${slugify(review.canonicalName)}`;
    if (existingModels.has(id)) continue;
    const acceptedBrands = new Set(review.sourceBrandIds || [review.brandId]);
    const acceptedNames = new Set(review.sourceNames.map(normalizeTerm));
    const observations = unmatchedRows.filter((row) => acceptedBrands.has(row.brandId) && acceptedNames.has(normalizeTerm(row.commercialName)));
    const observedSourceNames = [...new Set(observations.map((row) => row.commercialName))].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
    const years = [...new Set(observations.flatMap((row) => row.years || []))].sort((left, right) => left - right);
    const registrations = observations.reduce((sum, row) => sum + (row.registrations || 0), 0);
    const specificationGroups = observations.reduce((sum, row) => sum + (row.specificationGroups || 0), 0);
    const eeaSourceIds = sourceIdsForYears(years);
    const evidenceSourceId = review.officialSourceId || eeaSourceIds[0];
    if (!evidenceSourceId) throw new Error(`Reviewed model ${review.brandId}/${review.canonicalName} has neither official nor EEA evidence`);
    const sourceNames = observedSourceNames.map((value) => ({
      value,
      kind: "source_spelling",
      safe: true,
      language: "en",
      market: "Europe",
      sourceIds: sourceIdsForYears(observations.filter((row) => row.commercialName === value).flatMap((row) => row.years || []))
    }));
    const notes = [];
    if (years.length) notes.push(`EEA registration observations cover ${years.join(", ")}; ${registrations} registrations and ${specificationGroups} specification groups. Counts establish observed presence, not production boundaries.`);
    if (review.officialSourceId) notes.push(`Manufacturer identity is corroborated by ${review.officialSourceId}.`);
    notes.push("Review status: body style, generation boundary, canonical cover and the full engine/grade inventory remain pending; no trim or powertrain label has been promoted to a separate model.");
    records.push({
      id,
      brandId: review.brandId,
      canonicalName: review.canonicalName,
      slug: slugify(review.canonicalName),
      aliases: [],
      sourceNames,
      productionFrom: null,
      productionTo: null,
      bodyTypes: [],
      powertrainKinds: [],
      mediaIds: [],
      status: "review",
      evidence: [{
        sourceId: evidenceSourceId,
        fields: ["canonicalName"],
        status: "verified",
        confidence: "official",
        note: review.officialSourceId ? "Manufacturer model identity; EEA source spellings are preserved separately." : "Exact EEA registered commercial-name identity retained after manual model-boundary review."
      }],
      researchNotes: notes,
      updatedAt: verifiedAt
    });
    reviewRows.push({ id, brandId: review.brandId, canonicalName: review.canonicalName, sourceNames: observedSourceNames, years, registrations, specificationGroups, officialSourceId: review.officialSourceId });
  }

  records.sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    policy: {
      manuallyReviewedModelBoundariesOnly: true,
      trimsAndPowertrainsNotPromoted: true,
      observationYearsNotUsedAsProductionBoundaries: true,
      crossBrandManufacturerRowsRetainedOnlyWhenCommercialIdentityIsExplicit: true,
      automaticPublicationReady: false
    },
    totals: {
      reviewedDefinitions: REVIEWED_MODELS.length,
      newReviewModels: records.length,
      brands: new Set(records.map((record) => record.brandId)).size,
      observedRegistrations: reviewRows.reduce((sum, row) => sum + row.registrations, 0),
      observedSpecificationGroups: reviewRows.reduce((sum, row) => sum + row.specificationGroups, 0),
      officialManufacturerSources: OFFICIAL_SOURCES.length
    },
    records: reviewRows
  };
  const ingestion = {
    schemaVersion: 2,
    batches: [
      ...chunk("source", OFFICIAL_SOURCES),
      ...chunk("model", records)
    ]
  };
  return { report, ingestion };
}

async function main() {
  const { report, ingestion } = await buildEeaReviewedCommercialModelBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
