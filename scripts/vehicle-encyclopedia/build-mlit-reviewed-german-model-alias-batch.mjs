import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const MLIT_REPORT = path.join(WORKSPACE_ROOT, "reports/model-mlit-japan-2015-2026.json");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-mlit-reviewed-german-aliases.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-mlit-reviewed-german-aliases-2026-08-17.json");
const INCLUDED_BRANDS = new Set(["audi", "bmw", "mercedes-benz", "volkswagen", "porsche", "mini"]);

function fold(value) {
  return String(value || "").normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();
}

function classifyAudi(sourceName) {
  const value = fold(sourceName);
  const ordered = [
    ["audi/rs-e-tron-gt", /^RS E-?TRON GT/],
    ["audi/s-e-tron-gt", /^S E-?TRON GT/],
    ["audi/e-tron-gt", /^E-?TRON GT/],
    ["audi/rsq3", /^RSQ3/], ["audi/rsq8", /^RSQ8/],
    ["audi/rs3", /^RS3/], ["audi/rs4", /^RS4/], ["audi/rs5", /^RS5/], ["audi/rs6", /^RS6/], ["audi/rs7", /^RS7/],
    ["audi/sq2", /^SQ2/], ["audi/sq5", /^SQ5/], ["audi/sq6", /^SQ6/], ["audi/sq7", /^SQ7/], ["audi/sq8", /^SQ8/],
    ["audi/tt-rs", /^TTRS/], ["audi/tts", /^TTS/], ["audi/tt", /^TT(?:\s|$)/],
    ["audi/s1", /^S1(?:\s|\/|$)/], ["audi/s3", /^S3(?:\s|\/|$)/], ["audi/s4", /^S4(?:\s|\/|$)/], ["audi/s5", /^S5(?:\s|\/|$)/],
    ["audi/s6", /^S6(?:\s|\/|$)/], ["audi/s7", /^S7(?:\s|\/|$)/], ["audi/s8", /^S8(?:\s|\/|$)/],
    ["audi/a1", /^A1(?:\s|\/|$)/], ["audi/a2", /^A2(?:\s|\/|$)/], ["audi/a3", /^A3(?:\s|\/|$)/], ["audi/a4", /^A4(?:\s|\/|$)/],
    ["audi/a5", /^A5(?:\s|\/|$)/], ["audi/a6", /^A6(?:\s|\/|$)/], ["audi/a7", /^A7(?:\s|\/|$)/], ["audi/a8", /^A8(?:\s|L|$)/],
    ["audi/q2", /^Q2(?:\s|$)/], ["audi/q3", /^Q3(?:\s|$)/], ["audi/q4", /^Q4(?:\s|$)/], ["audi/q5", /^Q5(?:\s|$)/],
    ["audi/q6", /^Q6(?:\s|$)/], ["audi/q7", /^Q7(?:\s|$)/], ["audi/q8", /^Q8(?:\s|$)/],
    ["audi/r8", /^R8(?:\s|$)/], ["audi/e-tron", /^E-?TRON(?:\s|$)/]
  ];
  return ordered.find(([, pattern]) => pattern.test(value))?.[0] || null;
}

function classifyMini(sourceName) {
  const value = fold(sourceName);
  if (!value.includes("MINI") && !/[クグ]?[ー-]?[パー]|クロスオーバー/.test(sourceName)) return null;
  if (/ペースマン/.test(sourceName)) return "mini/paceman";
  if (/クラブマン|CLUBMAN/.test(value)) return "mini/clubman";
  if (/クロスオーバー|クロスオ-バ-|カントリーマン|COUNTRYMAN/.test(sourceName) || /COUNTRYMAN/.test(value)) return "mini/countryman";
  if (/コンバーチブル|コンバ-チブル|CONVERTIBLE/.test(sourceName) || /CONVERTIBLE/.test(value)) return "mini/convertible";
  if (/\bJCW\b|JOHN COOPER WORKS/.test(value)) return "mini/jcw";
  if (/\bONE\b/.test(value)) return "mini/one";
  if (/COOPER|クーパ|ク-パ/.test(value) || /クーパ|ク-パ/.test(sourceName)) return "mini/cooper";
  return null;
}

function classifyBmw(sourceName) {
  if (/^MINI\b/i.test(sourceName)) return classifyMini(sourceName);
  if (/^クロスオーバー(?:\s+A4)?$/i.test(sourceName)) return null;
  const value = fold(sourceName).replace(/^BMW\s+/i, "");
  const fixed = [
    ["bmw/1-series", /^(?:ACTIVEHYBRID\s*1|M13[05]|M140|1\d{2})/],
    ["bmw/2-series", /^(?:M23[05]|M240|2\d{2})/],
    ["bmw/3-series", /^(?:ACTIVEHYBRID\s*3|M340|3\d{2})/],
    ["bmw/4-series", /^(?:M440|4\d{2})/],
    ["bmw/5-series", /^(?:ACTIVEHYBRID\s*5|M550|5\d{2})/],
    ["bmw/6-series", /^6\d{2}/], ["bmw/7-series", /^(?:M760|7\d{2})/], ["bmw/8-series", /^(?:M850|8\d{2})/],
    ["bmw/m2", /^M2(?:\s|$)/], ["bmw/m3", /^M3(?:\s|$)/], ["bmw/m4", /^M4(?:\s|$)/], ["bmw/m5", /^M5(?:\s|$)/],
    ["bmw/m6", /^M6(?:\s|$)/], ["bmw/m8", /^M8(?:\s|$)/],
    ["bmw/x1", /^X1(?:\s|$)/], ["bmw/x2", /^X2(?:\s|$)/], ["bmw/x3", /^X3(?:\s|M|$)/], ["bmw/x4", /^X4(?:\s|M|$)/],
    ["bmw/x5", /^X5(?:\s|M|$)/], ["bmw/x6", /^X6(?:\s|M|$)/], ["bmw/x7", /^X7(?:\s|$)/], ["bmw/xm", /^XM(?:\s|$)/],
    ["bmw/z3", /^Z3(?:\s|$)/], ["bmw/z4", /^Z4(?:\s|$)/],
    ["bmw/i3", /^I3(?:\s|$)/], ["bmw/i4", /^I4(?:\s|$)/], ["bmw/i5", /^I5(?:\s|$)/], ["bmw/i7", /^I7(?:\s|$)/],
    ["bmw/i8", /^I8(?:\s|$)/], ["bmw/ix1", /^IX1(?:\s|$)/], ["bmw/ix2", /^IX2(?:\s|$)/], ["bmw/ix3", /^IX3(?:\s|$)/], ["bmw/ix", /^IX(?:\s|$)/]
  ];
  return fixed.find(([, pattern]) => pattern.test(value))?.[0] || null;
}

function classifyMercedes(sourceName) {
  if (/^Mini クーパーD クロスオーバー$/i.test(sourceName)) return null;
  if (/^メルセデス・マイバッハ/.test(sourceName)) return "mercedes-benz/maybach";
  let value = fold(sourceName)
    .replace(/^MERCEDES-AMG\s*/i, "")
    .replace(/^メルセデス\s*AMG\s*/i, "");
  const fixed = [
    ["mercedes-benz/amg-gt", /^GT(?:\s|\d|$)/],
    ["mercedes-benz/cla", /^CLA/], ["mercedes-benz/cle", /^CLE/], ["mercedes-benz/cls", /^CLS/],
    ["mercedes-benz/gla", /^GLA/], ["mercedes-benz/glb", /^GLB/], ["mercedes-benz/glc", /^GLC/], ["mercedes-benz/glk", /^GLK/],
    ["mercedes-benz/gle", /^GLE/], ["mercedes-benz/gls", /^GLS/], ["mercedes-benz/gl", /^GL(?:\s|\d)/],
    ["mercedes-benz/slc", /^SLC/], ["mercedes-benz/slk", /^SLK/], ["mercedes-benz/sls", /^SLS/], ["mercedes-benz/sl", /^SL(?:\s|\d)/],
    ["mercedes-benz/a-class", /^A(?:\s)?(?:180|200|250|35|45)/], ["mercedes-benz/b-class", /^B(?:\s)?(?:180|200|250)/],
    ["mercedes-benz/c-class", /^C(?:\s)?(?:180|200|220|250|300|350|43|450|63)/],
    ["mercedes-benz/e-class", /^E(?:\s)?(?:200|220|250|300|350|400|43|450|53|550|63)/],
    ["mercedes-benz/g-class", /^G(?:\s)?(?:350|400|450|550|63)/],
    ["mercedes-benz/ml", /^ML/], ["mercedes-benz/r-class", /^R(?:\s)?350/],
    ["mercedes-benz/s-class", /^S(?:\s)?(?:300|400|450|500|550|560|580|600|63|65)/],
    ["mercedes-benz/v-class", /^V(?:\s)?220/], ["mercedes-benz/cl", /^CL(?:63|65)/]
  ];
  return fixed.find(([, pattern]) => pattern.test(value))?.[0] || null;
}

function classifyVolkswagen(sourceName) {
  const value = fold(sourceName);
  const fixed = [
    ["volkswagen/arteon", /^ARTEON/], ["volkswagen/polo", /^CROSSPOLO/], ["volkswagen/touran", /^(?:CROSS TOURAN|GOLF TOURAN)/],
    ["volkswagen/up", /^CROSS UP!/], ["volkswagen/golf", /^(?:NEW GOLF|GOLF)/], ["volkswagen/passat", /^PASSAT/],
    ["volkswagen/polo", /^POLO/], ["volkswagen/scirocco", /^SCIROCCO/], ["volkswagen/sharan", /^SHARAN/],
    ["volkswagen/t-cross", /^T-CROSS/], ["volkswagen/beetle", /^THE BEETLE/], ["volkswagen/tiguan", /^TIGUAN/],
    ["volkswagen/touareg", /^TOUAREG/], ["volkswagen/t-roc", /^T-ROC/], ["volkswagen/up", /^UP!/], ["volkswagen/cc", /^VOLKSWAGEN CC/]
  ];
  return fixed.find(([, pattern]) => pattern.test(value))?.[0] || null;
}

function classifyPorsche(sourceName) {
  const value = fold(sourceName);
  const fixed = [["porsche/718", /^718/], ["porsche/911", /^911/], ["porsche/cayenne", /^CAYENNE/], ["porsche/macan", /^MACAN/], ["porsche/panamera", /^PANAMERA/]];
  return fixed.find(([, pattern]) => pattern.test(value))?.[0] || null;
}

function classify(brandId, sourceName) {
  if (brandId === "audi") return classifyAudi(sourceName);
  if (brandId === "bmw") return classifyBmw(sourceName);
  if (brandId === "mercedes-benz") return classifyMercedes(sourceName);
  if (brandId === "volkswagen") return classifyVolkswagen(sourceName);
  if (brandId === "porsche") return classifyPorsche(sourceName);
  if (brandId === "mini") return classifyMini(sourceName);
  return null;
}

function rejectionReason(brandId, sourceName) {
  if (brandId === "bmw" && /^クロスオーバー(?:\s+A4)?$/i.test(sourceName)) return "generic_body_family_without_model";
  if (brandId === "mercedes-benz" && /^Mini クーパーD クロスオーバー$/i.test(sourceName)) return "wrong_brand_contamination";
  return "unclassified_requires_manual_review";
}

function mlitSourceId(url) {
  return `src-mlit-passenger-${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

function chunk(entityType, records) {
  return Array.from({ length: Math.ceil(records.length / 250) }, (_, index) => ({ schemaVersion: 2, entityType, chunk: index + 1, maxRecords: 250, records: records.slice(index * 250, (index + 1) * 250) }));
}

function language(value) {
  return /^[\x00-\x7F]+$/.test(value) ? "en" : "ja";
}

export async function buildMlitReviewedGermanModelAliasBatch({ verifiedAt = "2026-08-17" } = {}) {
  const [workspace, mlit] = await Promise.all([loadWorkspace(), readJson(MLIT_REPORT)]);
  const modelById = new Map(workspace.records.model.map((model) => [model.id, model]));
  const existingSourceIds = new Set(workspace.records.source.map((source) => source.id));
  const decisions = [];
  const rejected = [];

  for (const candidate of mlit.candidates.filter((row) => INCLUDED_BRANDS.has(row.brandId) && row.disposition !== "exact_existing_alias")) {
    for (const sourceName of candidate.sourceNames) {
      const modelId = classify(candidate.brandId, sourceName);
      const common = {
        sourceBrandId: candidate.brandId,
        sourceName,
        observedInventoryYears: candidate.observedInventoryYears || [],
        typeCodes: candidate.typeCodes || [],
        workbookUrls: candidate.workbookUrls || []
      };
      if (!modelId) {
        rejected.push({ ...common, reason: rejectionReason(candidate.brandId, sourceName) });
        continue;
      }
      if (!modelById.has(modelId)) throw new Error(`Missing German MLIT classifier target ${modelId} for ${candidate.brandId}/${sourceName}`);
      decisions.push({ ...common, modelId });
    }
  }

  const sources = new Map();
  const accepted = [];
  const updatedModels = [];
  const decisionsByModel = Map.groupBy(decisions, (decision) => decision.modelId);
  for (const [modelId, modelDecisions] of decisionsByModel) {
    const model = modelById.get(modelId);
    const sourceNames = structuredClone(model.sourceNames || []);
    for (const decision of modelDecisions) {
      const sourceIds = [...new Set(decision.workbookUrls.map(mlitSourceId))].sort();
      for (const url of decision.workbookUrls) {
        const id = mlitSourceId(url);
        if (existingSourceIds.has(id) || sources.has(id)) continue;
        sources.set(id, {
          id,
          type: "government_registry",
          title: `Japan passenger-car inventory workbook ${path.basename(new URL(url).pathname)}`,
          publisher: "Ministry of Land, Infrastructure, Transport and Tourism of Japan",
          url,
          documentId: path.basename(new URL(url).pathname),
          documentDate: null,
          verifiedAt,
          market: "Japan",
          language: "ja",
          supportedFields: ["canonicalName"],
          confidence: "official",
          status: "active",
          license: null,
          notes: "Official MLIT passenger-car inventory workbook. The exact market string is retained while body, grade, engine, drivetrain and transmission tokens remain below the canonical model family."
        });
      }
      const existing = sourceNames.find((row) => normalizeTerm(row.value) === normalizeTerm(decision.sourceName));
      if (existing) existing.sourceIds = [...new Set([...(existing.sourceIds || []), ...sourceIds])].sort();
      else sourceNames.push({ value: decision.sourceName, kind: "source_spelling", safe: true, language: language(decision.sourceName), market: "Japan", sourceIds });
      accepted.push({
        modelId,
        canonicalName: model.canonicalName,
        sourceBrandId: decision.sourceBrandId,
        sourceName: decision.sourceName,
        observedInventoryYears: decision.observedInventoryYears,
        typeCodes: decision.typeCodes,
        sourceIds
      });
    }
    updatedModels.push({ ...model, sourceNames, updatedAt: verifiedAt });
  }

  updatedModels.sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
  accepted.sort((left, right) => left.modelId.localeCompare(right.modelId, "en", { numeric: true }) || left.sourceName.localeCompare(right.sourceName, "ja", { numeric: true }));
  rejected.sort((left, right) => left.sourceBrandId.localeCompare(right.sourceBrandId, "en") || left.sourceName.localeCompare(right.sourceName, "ja", { numeric: true }));
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    policy: {
      exactMlitSourceNamesOnly: true,
      deterministicReviewedFamilyRules: true,
      trimBodyEngineTransmissionRemainBelowModel: true,
      bmwGroupMiniRowsMayTargetMiniBrand: true,
      ambiguousAndWrongBrandRowsRejected: true,
      automaticPublicationReady: false
    },
    totals: {
      sourceCandidateBrands: INCLUDED_BRANDS.size,
      updatedModels: updatedModels.length,
      acceptedSourceNames: accepted.length,
      rejectedSourceNames: rejected.length,
      unclassifiedSourceNames: rejected.filter((row) => row.reason === "unclassified_requires_manual_review").length,
      sourcesAdded: sources.size,
      referencedOfficialSources: new Set(accepted.flatMap((row) => row.sourceIds)).size
    },
    accepted,
    rejected
  };
  return { report, ingestion: { schemaVersion: 2, batches: [...chunk("source", [...sources.values()].sort((left, right) => left.id.localeCompare(right.id, "en"))), ...chunk("model", updatedModels)] } };
}

async function main() {
  const { report, ingestion } = await buildMlitReviewedGermanModelAliasBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
  if (report.totals.unclassifiedSourceNames) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
