import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, writeJson } from "./lib.mjs";
import { writeCollections } from "./ingest.mjs";
import { validateWorkspace } from "./validate.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-duplicate-repair-honda-cr-v.json");

function uniqueByNormalizedValue(rows) {
  const result = [];
  const byValue = new Map();
  for (const row of rows) {
    const key = normalizeTerm(row.value);
    const existing = byValue.get(key);
    if (!existing) {
      const copy = structuredClone(row);
      byValue.set(key, copy);
      result.push(copy);
      continue;
    }
    existing.sourceIds = [...new Set([...(existing.sourceIds || []), ...(row.sourceIds || [])])].sort();
    existing.safe = Boolean(existing.safe && row.safe);
  }
  return result;
}

export async function repairHondaCrvDuplicate({ verifiedAt = "2026-08-17", apply = false } = {}) {
  const workspace = await loadWorkspace();
  const duplicate = workspace.records.model.find((model) => model.id === "honda/cr");
  const canonical = workspace.records.model.find((model) => model.id === "honda/cr-v");
  if (!duplicate || !canonical) throw new Error("Expected both honda/cr and honda/cr-v before duplicate repair");
  if (duplicate.canonicalName !== "Cr" || duplicate.brandId !== "honda") throw new Error("Unexpected honda/cr record; refusing automatic repair");
  const childReferences = [
    ...workspace.records.generation.filter((row) => row.modelId === duplicate.id).map((row) => row.id),
    ...workspace.records.variant.filter((row) => row.modelId === duplicate.id).map((row) => row.id)
  ];
  if (childReferences.length) throw new Error(`Cannot remove honda/cr with child references: ${childReferences.join(", ")}`);

  const merged = {
    ...canonical,
    sourceNames: uniqueByNormalizedValue([...(canonical.sourceNames || []), ...(duplicate.sourceNames || [])]),
    evidence: [...(canonical.evidence || []), ...(duplicate.evidence || [])],
    researchNotes: [...new Set([...(canonical.researchNotes || []), "Merged the erroneous truncated EEA identity honda/cr into CR-V; all original EEA source spellings and evidence were preserved.", ...(duplicate.researchNotes || [])])],
    updatedAt: verifiedAt
  };
  const models = workspace.records.model.filter((model) => model.id !== duplicate.id).map((model) => model.id === canonical.id ? merged : model);
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    applied: apply,
    removedDuplicateId: duplicate.id,
    canonicalModelId: canonical.id,
    preservedSourceNames: duplicate.sourceNames?.length || 0,
    preservedEvidence: duplicate.evidence?.length || 0,
    childReferences: childReferences.length,
    modelsBefore: workspace.records.model.length,
    modelsAfter: models.length
  };
  if (!apply) return report;
  await writeCollections(WORKSPACE_ROOT, { ...workspace.records, model: models }, ["model"]);
  const validation = await validateWorkspace({ writeReports: true });
  if (validation.errors.length) throw new Error(`Post-repair validation failed: ${JSON.stringify(validation.errors.slice(0, 5))}`);
  await writeJson(REPORT_FILE, report);
  return report;
}

async function main() {
  const report = await repairHondaCrvDuplicate({ apply: process.argv.includes("--apply") });
  if (!process.argv.includes("--apply")) await writeJson(REPORT_FILE, report);
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
