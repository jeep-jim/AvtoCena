import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const MLIT_REPORT = path.join(WORKSPACE_ROOT, "reports/model-mlit-japan-2015-2026.json");
const PRIORITY_DECISIONS = path.join(WORKSPACE_ROOT, "reports/model-japan-priority-identity-decisions.json");
const IMPORT_DECISIONS = path.join(WORKSPACE_ROOT, "reports/model-mlit-reviewed-import-aliases.json");
const GERMAN_DECISIONS = path.join(WORKSPACE_ROOT, "reports/model-mlit-reviewed-german-aliases.json");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-mlit-japan-identity-coverage.json");

function key(brandId, sourceName) {
  return `${brandId}\u0000${normalizeTerm(sourceName)}`;
}

function addTarget(index, brandId, sourceName, modelId) {
  const id = key(brandId, sourceName);
  if (!index.has(id)) index.set(id, new Set());
  index.get(id).add(modelId);
}

export async function buildMlitJapanIdentityCoverage({ generatedAt = "2026-08-17" } = {}) {
  const [workspace, mlit, priority, imported, german] = await Promise.all([
    loadWorkspace(),
    readJson(MLIT_REPORT),
    readJson(PRIORITY_DECISIONS),
    readJson(IMPORT_DECISIONS),
    readJson(GERMAN_DECISIONS)
  ]);
  const modelById = new Map(workspace.records.model.map((model) => [model.id, model]));
  const sameBrandTargets = new Map();
  for (const model of workspace.records.model) {
    for (const name of [{ value: model.canonicalName }, ...(model.aliases || []), ...(model.sourceNames || [])]) {
      addTarget(sameBrandTargets, model.brandId, name.value, model.id);
    }
  }
  const reviewedTargets = new Map();
  for (const report of [imported, german]) {
    for (const accepted of report.accepted || []) {
      const sourceBrandId = accepted.sourceBrandId || accepted.modelId.split("/")[0];
      if (!modelById.has(accepted.modelId)) throw new Error(`Coverage report references missing model ${accepted.modelId}`);
      addTarget(reviewedTargets, sourceBrandId, accepted.sourceName, accepted.modelId);
    }
  }

  const rejected = new Map();
  for (const decision of priority.decisions || []) rejected.set(key(decision.brandId, decision.sourceName), decision.disposition);
  for (const report of [imported, german]) {
    for (const row of report.rejected || []) rejected.set(key(row.brandId || row.sourceBrandId, row.sourceName), row.reason);
  }

  const decisions = [];
  for (const candidate of mlit.candidates) {
    for (const sourceName of candidate.sourceNames) {
      const id = key(candidate.brandId, sourceName);
      const targets = [...new Set([...(reviewedTargets.get(id) || []), ...(sameBrandTargets.get(id) || [])])].sort();
      if (targets.length === 1) {
        decisions.push({ brandId: candidate.brandId, sourceName, disposition: "mapped", modelIds: targets, reason: null });
      } else if (targets.length > 1) {
        decisions.push({ brandId: candidate.brandId, sourceName, disposition: "ambiguous", modelIds: targets, reason: "multiple_canonical_targets" });
      } else if (rejected.has(id)) {
        decisions.push({ brandId: candidate.brandId, sourceName, disposition: "rejected", modelIds: [], reason: rejected.get(id) });
      } else {
        decisions.push({ brandId: candidate.brandId, sourceName, disposition: "unresolved", modelIds: [], reason: "no_reviewed_decision" });
      }
    }
  }

  const brands = [...new Set(decisions.map((row) => row.brandId))].sort();
  const byBrand = brands.map((brandId) => {
    const rows = decisions.filter((row) => row.brandId === brandId);
    return {
      brandId,
      sourceNames: rows.length,
      mapped: rows.filter((row) => row.disposition === "mapped").length,
      rejected: rows.filter((row) => row.disposition === "rejected").length,
      ambiguous: rows.filter((row) => row.disposition === "ambiguous").length,
      unresolved: rows.filter((row) => row.disposition === "unresolved").length
    };
  });
  const totals = {
    candidateRows: mlit.candidates.length,
    sourceNames: decisions.length,
    mapped: decisions.filter((row) => row.disposition === "mapped").length,
    rejected: decisions.filter((row) => row.disposition === "rejected").length,
    ambiguous: decisions.filter((row) => row.disposition === "ambiguous").length,
    unresolved: decisions.filter((row) => row.disposition === "unresolved").length
  };
  totals.decided = totals.mapped + totals.rejected;
  totals.decisionCoveragePercent = Number(((totals.decided / totals.sourceNames) * 100).toFixed(2));
  return {
    schemaVersion: 2,
    generatedAt,
    productionConnected: false,
    window: { market: "Japan", fromYear: 2015, toYear: 2026 },
    policy: {
      everyMlitSourceNameRequiresDecision: true,
      exactSourceSpellingPreserved: true,
      oneCanonicalModelTargetRequiredForMappedNames: true,
      rejectedNoiseCombinedAndWrongBrandRowsRemainAuditable: true,
      typeCodesNotPromotedToModelsOrVariants: true,
      automaticPublicationReady: false
    },
    totals,
    byBrand,
    rejected: decisions.filter((row) => row.disposition === "rejected"),
    ambiguous: decisions.filter((row) => row.disposition === "ambiguous"),
    unresolved: decisions.filter((row) => row.disposition === "unresolved")
  };
}

async function main() {
  const report = await buildMlitJapanIdentityCoverage();
  await writeJson(REPORT_FILE, report);
  console.log(JSON.stringify(report.totals, null, 2));
  if (report.totals.ambiguous || report.totals.unresolved) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
