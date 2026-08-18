import { cp, mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ENTITY_TYPES, WORKSPACE_ROOT, loadWorkspace, readJson, writeJson } from "./lib.mjs";
import { validateJsonSchema } from "./contract.mjs";
import { validateWorkspace } from "./validate.mjs";

const PREFIX = {
  source: "sources",
  brand: "brands",
  model: "models",
  generation: "generations",
  facelift: "facelifts",
  variant: "variants",
  media: "media",
};

export function mergeIngestion(existing, batches, { replaceExisting = false } = {}) {
  const records = Object.fromEntries(ENTITY_TYPES.map((type) => [type, [...existing.records[type]]]));
  const seenInput = new Map();
  const changedTypes = new Set();
  const errors = [];
  for (const batch of batches) {
    if (!ENTITY_TYPES.includes(batch.entityType)) {
      errors.push({ code: "ingest.entity_type", message: `Unknown entityType ${batch.entityType}` });
      continue;
    }
    changedTypes.add(batch.entityType);
    const current = new Map(records[batch.entityType].map((row) => [row.id, row]));
    for (const row of batch.records || []) {
      const inputType = seenInput.get(row.id);
      if (inputType) {
        errors.push({ code: "ingest.duplicate_input_id", message: `Input id ${row.id} appears more than once`, entityId: row.id, entityTypes: [inputType, batch.entityType] });
        continue;
      }
      seenInput.set(row.id, batch.entityType);
      if (current.has(row.id) && !replaceExisting) {
        errors.push({ code: "ingest.existing_id", message: `Input id ${row.id} already exists; use --replace-existing for an intentional replacement`, entityId: row.id, entityType: batch.entityType });
        continue;
      }
      current.set(row.id, row);
    }
    records[batch.entityType] = [...current.values()].sort((left, right) => left.id.localeCompare(right.id, "en"));
  }
  return { records, changedTypes: [...changedTypes].sort(), errors };
}

export async function writeCollections(root, records, changedTypes) {
  const chunksDir = path.join(root, "chunks");
  await mkdir(chunksDir, { recursive: true });
  for (const type of changedTypes) {
    const rows = records[type];
    for (let offset = 0; offset < rows.length; offset += 250) {
      const chunkNumber = Math.floor(offset / 250) + 1;
      const file = `${PREFIX[type]}-${String(chunkNumber).padStart(4, "0")}.json`;
      await writeJson(path.join(chunksDir, file), {
        schemaVersion: 2,
        entityType: type,
        chunk: chunkNumber,
        maxRecords: 250,
        records: rows.slice(offset, offset + 250),
      });
    }
  }
}

export async function prepareIngestion({ inputFile, root = WORKSPACE_ROOT, replaceExisting = false } = {}) {
  const input = await readJson(inputFile);
  if (input.schemaVersion !== 2 || !Array.isArray(input.batches) || !input.batches.length) {
    return { valid: false, errors: [{ code: "ingest.input_contract", message: "Input must be { schemaVersion: 2, batches: [chunk, ...] }" }] };
  }
  const chunkSchema = await readJson(path.join(root, "schema/entity-chunk.schema.json"));
  const contractErrors = input.batches.flatMap((batch, index) => validateJsonSchema(batch, chunkSchema).map((error) => ({ code: "ingest.chunk_contract", batch: index, ...error })));
  if (contractErrors.length) return { valid: false, errors: contractErrors };
  const existing = await loadWorkspace(root);
  const merged = mergeIngestion(existing, input.batches, { replaceExisting });
  if (merged.errors.length) return { valid: false, errors: merged.errors };
  const candidateRoot = await mkdtemp(path.join(os.tmpdir(), "avtocena-encyclopedia-ingest-"));
  await cp(root, candidateRoot, { recursive: true });
  await writeCollections(candidateRoot, merged.records, merged.changedTypes);
  const validation = await validateWorkspace({ root: candidateRoot });
  return {
    valid: validation.errors.length === 0,
    errors: validation.errors,
    candidateRoot,
    records: merged.records,
    changedTypes: merged.changedTypes,
    totals: validation.reports.coverage.totals,
  };
}

async function main() {
  const inputArg = process.argv.find((arg) => arg.startsWith("--input="));
  if (!inputArg) throw new Error("Usage: node scripts/vehicle-encyclopedia/ingest.mjs --input=<batch.json> [--replace-existing] [--apply]");
  const inputFile = path.resolve(inputArg.slice("--input=".length));
  const replaceExisting = process.argv.includes("--replace-existing");
  const apply = process.argv.includes("--apply");
  const prepared = await prepareIngestion({ inputFile, replaceExisting });
  if (!prepared.valid) {
    console.error(JSON.stringify({ valid: false, applied: false, errors: prepared.errors }, null, 2));
    process.exitCode = 1;
    return;
  }
  if (apply) {
    await writeCollections(WORKSPACE_ROOT, prepared.records, prepared.changedTypes);
    const validation = await validateWorkspace({ writeReports: true });
    if (validation.errors.length) throw new Error("Post-write validation failed unexpectedly");
  }
  console.log(JSON.stringify({ valid: true, applied: apply, changedTypes: prepared.changedTypes, totals: prepared.totals }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
