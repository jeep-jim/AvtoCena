import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, writeJson } from "./lib.mjs";
import { writeCollections } from "./ingest.mjs";
import { validateWorkspace } from "./validate.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-duplicate-repair-bmw-mini.json");
const DUPLICATE_TARGETS = new Map([
  ["bmw/clubman-cooper", "mini/clubman"],
  ["bmw/cooper", "mini/cooper"],
  ["bmw/cooper-s", "mini/cooper"],
  ["bmw/john-cooper-works", "mini/jcw"],
  ["bmw/mini", null],
  ["bmw/mini-cooper", "mini/cooper"],
  ["bmw/mini-one", "mini/one"],
  ["bmw/one", "mini/one"]
]);

function mergeSourceNames(left, right) {
  const result = structuredClone(left || []);
  for (const row of right || []) {
    const existing = result.find((candidate) => normalizeTerm(candidate.value) === normalizeTerm(row.value));
    if (!existing) {
      result.push(structuredClone(row));
      continue;
    }
    existing.sourceIds = [...new Set([...(existing.sourceIds || []), ...(row.sourceIds || [])])].sort();
    existing.safe = Boolean(existing.safe && row.safe);
  }
  return result;
}

export async function repairBmwMiniModelDuplicates({ verifiedAt = "2026-08-17", apply = false } = {}) {
  const workspace = await loadWorkspace();
  const modelById = new Map(workspace.records.model.map((model) => [model.id, model]));
  const replacements = new Map();
  const removed = [];

  for (const [duplicateId, targetId] of DUPLICATE_TARGETS) {
    const duplicate = modelById.get(duplicateId);
    if (!duplicate) throw new Error(`Expected duplicate model ${duplicateId}`);
    const childReferences = [
      ...workspace.records.generation.filter((row) => row.modelId === duplicateId).map((row) => row.id),
      ...workspace.records.variant.filter((row) => row.modelId === duplicateId).map((row) => row.id)
    ];
    if (childReferences.length) throw new Error(`Cannot remove ${duplicateId} with child references: ${childReferences.join(", ")}`);
    if (!targetId) {
      removed.push({ duplicateId, targetId: null, disposition: "generic_brand_label_removed", preservedSourceNames: 0, preservedEvidence: 0 });
      continue;
    }
    const target = replacements.get(targetId) || modelById.get(targetId);
    if (!target) throw new Error(`Missing canonical MINI target ${targetId}`);
    replacements.set(targetId, {
      ...target,
      sourceNames: mergeSourceNames(target.sourceNames, duplicate.sourceNames),
      evidence: [...(target.evidence || []), ...(duplicate.evidence || [])],
      researchNotes: [...new Set([...(target.researchNotes || []), `Merged erroneous BMW-parent-group model identity ${duplicateId} into ${targetId}.`, ...(duplicate.researchNotes || [])])],
      updatedAt: verifiedAt
    });
    removed.push({ duplicateId, targetId, disposition: "merged_into_mini_model", preservedSourceNames: duplicate.sourceNames?.length || 0, preservedEvidence: duplicate.evidence?.length || 0 });
  }

  const models = workspace.records.model
    .filter((model) => !DUPLICATE_TARGETS.has(model.id))
    .map((model) => replacements.get(model.id) || model);
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    applied: apply,
    modelsBefore: workspace.records.model.length,
    modelsAfter: models.length,
    duplicatesRemoved: removed.length,
    mergedDuplicates: removed.filter((row) => row.targetId).length,
    genericDuplicatesRemoved: removed.filter((row) => !row.targetId).length,
    removed
  };
  if (!apply) return report;
  await writeCollections(WORKSPACE_ROOT, { ...workspace.records, model: models }, ["model"]);
  const validation = await validateWorkspace({ writeReports: true });
  if (validation.errors.length) throw new Error(`Post-repair validation failed: ${JSON.stringify(validation.errors.slice(0, 5))}`);
  await writeJson(REPORT_FILE, report);
  return report;
}

async function main() {
  const report = await repairBmwMiniModelDuplicates({ apply: process.argv.includes("--apply") });
  if (!process.argv.includes("--apply")) await writeJson(REPORT_FILE, report);
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
