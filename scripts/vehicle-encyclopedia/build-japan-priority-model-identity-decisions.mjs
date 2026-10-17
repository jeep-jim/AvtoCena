import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const MLIT_REPORT = path.join(WORKSPACE_ROOT, "reports/model-mlit-japan-2015-2026.json");
const OUTPUT = path.join(WORKSPACE_ROOT, "reports/model-japan-priority-identity-decisions.json");
const PRIORITY_BRANDS = ["toyota", "honda", "nissan", "suzuki", "mazda", "subaru", "mitsubishi", "daihatsu"];

const DECISIONS = [
  { brandId: "toyota", sourceName: "*2", disposition: "fragment_noise", targetModelIds: [] },
  { brandId: "toyota", sourceName: "アリオン プレミオ", disposition: "combined_models", targetModelIds: ["toyota/allion", "toyota/premio"] },
  { brandId: "toyota", sourceName: "アルファード ヴェルファイア", disposition: "combined_models", targetModelIds: ["toyota/alphard", "toyota/vellfire"] },
  { brandId: "toyota", sourceName: "ヴォクシー ノア", disposition: "combined_models", targetModelIds: ["toyota/voxy", "toyota/noah"] },
  { brandId: "toyota", sourceName: "エスクァイア ノア", disposition: "combined_models", targetModelIds: ["toyota/esquire", "toyota/noah"] },
  { brandId: "toyota", sourceName: "クラウンセダン クラウンコンフォート", disposition: "combined_models", targetModelIds: ["toyota/crown-sedan", "toyota/crown-comfort"] },
  { brandId: "toyota", sourceName: "ノア ヴォクシー", disposition: "combined_models", targetModelIds: ["toyota/noah", "toyota/voxy"] },
  { brandId: "toyota", sourceName: "ノア ヴォクシー エスクァイア", disposition: "combined_models", targetModelIds: ["toyota/noah", "toyota/voxy", "toyota/esquire"] },
  { brandId: "toyota", sourceName: "プレミオ アリオン", disposition: "combined_models", targetModelIds: ["toyota/premio", "toyota/allion"] },
  { brandId: "toyota", sourceName: "ポルテ スペイド", disposition: "combined_models", targetModelIds: ["toyota/porte", "toyota/spade"] },
  { brandId: "toyota", sourceName: "ルーミー * タンク *", disposition: "combined_models", targetModelIds: ["toyota/roomy", "toyota/tank"] },
  { brandId: "honda", sourceName: "N BOX Custom", disposition: "grade_or_derivative", targetModelIds: ["honda/n-box"] },
  { brandId: "honda", sourceName: "N-BOX + Custom", disposition: "grade_or_derivative", targetModelIds: ["honda/n-box"] },
  { brandId: "honda", sourceName: "N-BOX Custom", disposition: "grade_or_derivative", targetModelIds: ["honda/n-box"] },
  { brandId: "honda", sourceName: "N-BOX CUSTOM", disposition: "grade_or_derivative", targetModelIds: ["honda/n-box"] },
  { brandId: "honda", sourceName: "N-BOX JOY", disposition: "grade_or_derivative", targetModelIds: ["honda/n-box"] },
  { brandId: "honda", sourceName: "N-WGN Custom", disposition: "grade_or_derivative", targetModelIds: ["honda/n-wgn"] },
  { brandId: "honda", sourceName: "N-WGN CUSTOM", disposition: "grade_or_derivative", targetModelIds: ["honda/n-wgn"] },
  { brandId: "honda", sourceName: "ステップワゴン スパーダ", disposition: "grade_or_derivative", targetModelIds: ["honda/step-wgn"] },
  { brandId: "mazda", sourceName: "マツダ教習車", disposition: "special_purpose_label", targetModelIds: [] },
  { brandId: "mitsubishi", sourceName: "デリカ", disposition: "model_family", targetModelIds: ["mitsubishi/delica-d2", "mitsubishi/delica-d3", "mitsubishi/delica-d5", "mitsubishi/delica-mini"] },
  { brandId: "mitsubishi", sourceName: "リューション", disposition: "fragment_noise", targetModelIds: [] }
];

function modelTerms(model) {
  return [model.canonicalName, ...(model.aliases || []).map((alias) => alias.value), ...(model.sourceNames || []).map((sourceName) => sourceName.value)];
}

export async function buildJapanPriorityModelIdentityDecisions() {
  const [workspace, mlit] = await Promise.all([loadWorkspace(), readJson(MLIT_REPORT)]);
  const modelIds = new Set(workspace.records.model.map((model) => model.id));
  const coveredTermsByBrand = new Map(PRIORITY_BRANDS.map((brandId) => [brandId, new Set()]));
  for (const model of workspace.records.model) {
    if (!coveredTermsByBrand.has(model.brandId)) continue;
    for (const term of modelTerms(model)) coveredTermsByBrand.get(model.brandId).add(normalizeTerm(term));
  }

  const residual = PRIORITY_BRANDS.flatMap((brandId) => {
    const covered = coveredTermsByBrand.get(brandId);
    return [...new Set(mlit.candidates
      .filter((candidate) => candidate.brandId === brandId)
      .flatMap((candidate) => candidate.sourceNames)
      .filter((sourceName) => !covered.has(normalizeTerm(sourceName))))]
      .map((sourceName) => ({ brandId, sourceName }));
  }).sort((left, right) => `${left.brandId}/${left.sourceName}`.localeCompare(`${right.brandId}/${right.sourceName}`, "ja"));

  const decisionKeys = new Set(DECISIONS.map((decision) => `${decision.brandId}/${decision.sourceName}`));
  const residualKeys = new Set(residual.map((row) => `${row.brandId}/${row.sourceName}`));
  const missingDecisions = residual.filter((row) => !decisionKeys.has(`${row.brandId}/${row.sourceName}`));
  const staleDecisions = DECISIONS.filter((decision) => !residualKeys.has(`${decision.brandId}/${decision.sourceName}`));
  const missingTargets = DECISIONS.flatMap((decision) => decision.targetModelIds.filter((id) => !modelIds.has(id)).map((id) => ({ sourceName: decision.sourceName, id })));
  if (missingDecisions.length || staleDecisions.length || missingTargets.length) {
    throw new Error(JSON.stringify({ missingDecisions, staleDecisions, missingTargets }, null, 2));
  }

  const byDisposition = Object.fromEntries([...new Set(DECISIONS.map((decision) => decision.disposition))].sort().map((disposition) => [
    disposition,
    DECISIONS.filter((decision) => decision.disposition === disposition).length
  ]));
  return {
    schemaVersion: 2,
    generatedAt: "2026-08-17",
    productionConnected: false,
    window: { market: "Japan", fromYear: 2015, toYear: 2026 },
    policy: {
      englishCanonicalModelRequired: true,
      combinedRegistryLabelsNeverAutoResolve: true,
      gradesAndDerivativesRemainBelowModelLayer: true,
      fragmentsAndSpecialPurposeLabelsNeverBecomeModels: true
    },
    totals: {
      priorityBrands: PRIORITY_BRANDS.length,
      residualSourceNames: residual.length,
      acceptedAsNewModels: 0,
      decisionsByDisposition: byDisposition
    },
    brandsWithNoResidualSourceNames: PRIORITY_BRANDS.filter((brandId) => !residual.some((row) => row.brandId === brandId)),
    decisions: DECISIONS
  };
}

async function main() {
  const report = await buildJapanPriorityModelIdentityDecisions();
  await writeJson(OUTPUT, report);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
