import fs from "node:fs/promises";

async function read(file) { return fs.readFile(file, "utf8"); }
async function write(file, value) { await fs.writeFile(file, value); }
function replaceOnce(text, from, to, label) {
  const index = text.indexOf(from);
  if (index < 0) throw new Error(`knowledge_core_marker_missing:${label}`);
  if (text.indexOf(from, index + from.length) >= 0) throw new Error(`knowledge_core_marker_ambiguous:${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

const storagePath = "apps/web/lib/catalog/storage.ts";
let storage = await read(storagePath);
const legacyImport = `import { enrichOfferWithVehicleKnowledge, resolveVehicleModelQuery } from "./vehicle-knowledge";`;
if (storage.includes(legacyImport)) {
  storage = replaceOnce(storage, legacyImport, `import { resolveVehicleModelQuery } from "./vehicle-knowledge";\nimport { enrichOfferWithKnowledgeCore } from "./knowledge-core";`, "storage_core_import");
}
storage = storage.replaceAll("enrichOfferWithVehicleKnowledge(", "enrichOfferWithKnowledgeCore(");
if (!storage.includes("enrichOfferWithKnowledgeCore")) throw new Error("knowledge_core_marker_missing:storage_core_calls");
await write(storagePath, storage);

const identityPath = "scripts/catalog-apply-encyclopedia-identity-master.mjs";
let identity = await read(identityPath);
identity = identity.replace(
  `import { enrichOfferWithVehicleKnowledge } from "../apps/web/lib/catalog/vehicle-knowledge.ts";`,
  `import { enrichOfferWithKnowledgeCore } from "../apps/web/lib/catalog/knowledge-core.ts";`,
);
identity = identity.replaceAll("enrichOfferWithVehicleKnowledge(", "enrichOfferWithKnowledgeCore(");
identity = identity.replace(
  `if (changed && (!Number(offer.powerHp || 0) || !Number(offer.engineCc || 0) || !clean(offer.fuel))) {`,
  `if (identity.canonicalModelId) {`,
);
identity = identity.replace(
  `      fuel: clean(offer.fuel),\n    };`,
  `      fuel: clean(offer.fuel),\n      bodyType: clean(offer.bodyType),\n      transmission: clean(offer.transmission),\n      drive: clean(offer.drive),\n    };`,
);
identity = identity.replace(
  `      knowledgeEnriched = Number(offer.powerHp || 0) !== before.powerHp\n        || Number(offer.engineCc || 0) !== before.engineCc\n        || clean(offer.fuel) !== before.fuel;`,
  `      knowledgeEnriched = Number(offer.powerHp || 0) !== before.powerHp\n        || Number(offer.engineCc || 0) !== before.engineCc\n        || clean(offer.fuel) !== before.fuel\n        || clean(offer.bodyType) !== before.bodyType\n        || clean(offer.transmission) !== before.transmission\n        || clean(offer.drive) !== before.drive\n        || Boolean(offer?.operational?.knowledgeCore?.variantId);`,
);
if (!identity.includes("enrichOfferWithKnowledgeCore") || !identity.includes("identity.canonicalModelId")) {
  throw new Error("knowledge_core_marker_missing:identity_integration");
}
await write(identityPath, identity);

const workflowPath = ".github/workflows/catalog-v3-market-10k-reusable.yml";
let workflow = await read(workflowPath);
const validationMarker = `      - run: npx tsx scripts/catalog-validate-source-scale.mjs`;
const gapStep = `      - name: Build Knowledge CORE gap report\n        env:\n          CATALOG_KNOWLEDGE_GAPS_OUTPUT: catalog-v3-\${{ inputs.market }}-knowledge-gaps.json\n        run: npx tsx scripts/catalog-build-knowledge-gaps.mjs\n      - run: npx tsx scripts/catalog-validate-source-scale.mjs`;
if (!workflow.includes("Build Knowledge CORE gap report")) workflow = replaceOnce(workflow, validationMarker, gapStep, "workflow_gap_step");
const auditArtifact = `            catalog-v3-\${{ inputs.market }}-postpublish-audit.json`;
if (!workflow.includes("catalog-v3-${{ inputs.market }}-knowledge-gaps.json")) {
  workflow = replaceOnce(workflow, auditArtifact, `${auditArtifact}\n            catalog-v3-\${{ inputs.market }}-knowledge-gaps.json`, "workflow_gap_artifact");
}
await write(workflowPath, workflow);

const manifestPath = "data/catalog/vehicle-encyclopedia-v2/manifest.json";
let manifest = await read(manifestPath);
manifest = manifest.replace(`"targetYearFrom": 2015`, `"targetYearFrom": 2010`);
manifest = manifest.replace(`"marketId": "japan",\n      "yearFrom": 2015`, `"marketId": "japan",\n      "yearFrom": 2010`);
manifest = manifest.replaceAll("Japan uses the broader 2015-2026 window", "Japan uses the broader 2010-2026 window");
if (!manifest.includes(`"marketId": "japan",\n      "yearFrom": 2010`)) throw new Error("knowledge_core_marker_missing:japan_2010");
await write(manifestPath, manifest);

const taskPath = "data/catalog/vehicle-encyclopedia-v2/CODEX_MASTER_TASK.md";
let task = await read(taskPath);
task = task.replace("Japan priority coverage is 2015-present; every other active market is 2020-present.", "Japan mandatory CORE coverage is 2010-present; every other active market is 2020-present.");
task = task.replace("After the pilot, STOP and report:", "After the pilot quality check, report and continue automatically into the full CORE denominator:");
task = task.replace("Do not silently proceed to hundreds of brands until the pilot data quality is demonstrated.", "Do not stop at the pilot. Once validation is green, continue through every source-backed passenger/light-passenger brand and model in the approved market windows; unresolved rows go to the knowledge-gap queue instead of being guessed or discarded.");
task = task.replace("Japan priority coverage is 2015-present", "Japan mandatory CORE coverage is 2010-present");
await write(taskPath, task);

const ciPath = ".github/workflows/ci.yml";
let ci = await read(ciPath);
const knowledgeTestMarker = `      - name: Vehicle knowledge and model search tests\n        run: node --import tsx --test tests/vehicle-knowledge.test.ts`;
if (!ci.includes("catalog-knowledge-core-contract.test.ts")) {
  ci = replaceOnce(ci, knowledgeTestMarker, `      - name: Vehicle knowledge and model search tests\n        run: node --import tsx --test tests/vehicle-knowledge.test.ts tests/catalog-knowledge-core-contract.test.ts`, "ci_core_test");
}
const scriptCheckNeedle = `node --check scripts/catalog-publish-market.mjs`;
if (!ci.includes("catalog-build-knowledge-gaps.mjs")) {
  ci = ci.replace(scriptCheckNeedle, `${scriptCheckNeedle} && node --check scripts/catalog-build-knowledge-gaps.mjs && node --check scripts/catalog-verify-current-offers.mjs`);
}
await write(ciPath, ci);

console.log("unified Knowledge CORE integration applied");
