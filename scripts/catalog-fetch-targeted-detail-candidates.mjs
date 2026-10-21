import fs from "node:fs/promises";
import path from "node:path";
import { readCheckpointJsonl } from "./lib/read-checkpoint-jsonl.mjs";
import { readLatestSavedObservations } from "./lib/catalog-saved-artifact.mjs";
import { deriveSavedDetailNeeds, detailRecoveryCapability, validateEnrichedDetail, SAVED_DETAIL_RECOVERY_MARKETS } from "../apps/web/lib/catalog/saved-detail-recovery.ts";
import { directFixedIdRecoveryRegistered, recoverSavedDetailCandidate } from "../apps/web/lib/catalog/saved-detail-fetchers.ts";

const baseInput = String(process.env.CATALOG_TARGETED_DETAIL_BASE || "").trim();
const queueInput = String(process.env.CATALOG_TARGETED_DETAIL_QUEUE || "").trim();
const market = String(process.env.CATALOG_TARGETED_DETAIL_MARKET || "").trim();
const output = String(process.env.CATALOG_TARGETED_DETAIL_CANDIDATES_OUTPUT || "targeted-detail-candidates.jsonl").trim();
const reportFile = String(process.env.CATALOG_TARGETED_DETAIL_CANDIDATES_REPORT || `${output}.report.json`).trim();
const configuredLimit = Math.floor(Number(process.env.CATALOG_TARGETED_DETAIL_MAX_REQUESTS || 200));
const maxRequests = Math.max(1, Math.min(500, Number.isFinite(configuredLimit) ? configuredLimit : 200));
const configuredDelay = Math.floor(Number(process.env.CATALOG_TARGETED_DETAIL_DELAY_MS || 350));
const delayMs = Math.max(100, Math.min(5_000, Number.isFinite(configuredDelay) ? configuredDelay : 350));
const configuredFailureLimit = Math.floor(Number(process.env.CATALOG_TARGETED_DETAIL_SOURCE_FAILURE_LIMIT || 3));
const sourceFailureLimit = Math.max(1, Math.min(10, Number.isFinite(configuredFailureLimit) ? configuredFailureLimit : 3));

function isContractFailure(error) {
  return /(?:identity|source_url|source_offer_id|handler_missing|capability|disallowed_mutation|evidence_regression)/i
    .test(String(error?.message || error));
}

if (!baseInput || !queueInput) throw new Error("targeted_detail_candidate_inputs_required");
if (!SAVED_DETAIL_RECOVERY_MARKETS.includes(market)) throw new Error(`targeted_detail_market_invalid:${market}`);
if (!output || !reportFile || output === reportFile) throw new Error("targeted_detail_candidate_output_invalid");
if (process.env.CATALOG_IMAGE_STORAGE_MODE && process.env.CATALOG_IMAGE_STORAGE_MODE !== "source_urls_only") {
  throw new Error("targeted_detail_source_urls_only_required");
}
process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.CATALOG_SOURCE_INVENTORY_MODE = "1";
process.env.CATALOG_SOURCE_RETRY_ATTEMPTS = String(Math.max(1, Math.min(3,
  Number(process.env.CATALOG_SOURCE_RETRY_ATTEMPTS || 3))));

const base = await readLatestSavedObservations(baseInput, market);
const baseById = new Map(base.latest.map((row) => [`${row.observation.offer.sourceId}\u0000${row.observation.offer.id}`, row]));
const tasks = [];
const taskKeys = new Set();
for await (const row of readCheckpointJsonl(queueInput)) {
  if (row?.version !== 1 || row?.market !== market || !row?.sourceId || !row?.offerId || !row?.sourceOfferId
    || !row?.sourceUrl || !row?.inputRevisionHash || !["listing", "detail"].includes(row?.latestStage)
    || !Array.isArray(row?.needs) || !Array.isArray(row?.actionableNeeds) || !row.actionableNeeds.length) {
    throw new Error("targeted_detail_queue_invalid");
  }
  const key = `${row.sourceId}\u0000${row.offerId}`;
  if (taskKeys.has(key)) throw new Error(`targeted_detail_queue_duplicate:${row.offerId}`);
  taskKeys.add(key);
  tasks.push(row);
}
const candidates = [];
const runnable = [];
let attempted = 0;
let succeeded = 0;
let unresolved = 0;
let contractFailures = 0;
for (const task of tasks) {
  const key = `${task.sourceId}\u0000${task.offerId}`;
  const saved = baseById.get(key);
  const common = {
    version: 1, market, sourceId: task.sourceId, offerId: task.offerId,
    sourceOfferId: task.sourceOfferId, inputRevisionHash: task.inputRevisionHash,
    requestedNeeds: task.actionableNeeds,
  };
  if (!saved || saved.revisionHash !== task.inputRevisionHash) {
    contractFailures++;
    candidates.push({ ...common, outcome: "rejected", reason: "base_revision_hash_mismatch" });
    continue;
  }
  if (String(saved.observation.offer.sourceOfferId || "") !== String(task.sourceOfferId)) {
    contractFailures++;
    candidates.push({ ...common, outcome: "rejected", reason: "queue_source_offer_id_mismatch" });
    continue;
  }
  const expectedNeeds = deriveSavedDetailNeeds(saved.observation.offer, saved.observation.stage);
  const decision = detailRecoveryCapability(saved.observation.offer, expectedNeeds, saved.observation.stage);
  if (task.latestStage !== saved.observation.stage
    || String(task.sourceUrl) !== String(saved.observation.offer.operational?.sourceUrl || "")
    || JSON.stringify(task.needs) !== JSON.stringify(expectedNeeds)
    || decision.transport !== task.transport || decision.runnable !== task.runnable
    || JSON.stringify(decision.actionable) !== JSON.stringify(task.actionableNeeds)) {
    contractFailures++;
    candidates.push({ ...common, outcome: "rejected", reason: "fixed_id_capability_changed" });
    continue;
  }
  if (!task.runnable || task.transport !== "direct_fixed_id") {
    unresolved++;
    candidates.push({ ...common, outcome: "unresolved", reason: task.transport === "fixed_id_bridge_required"
      ? "fixed_id_bridge_required" : "direct_fixed_id_not_runnable" });
    continue;
  }
  if (!directFixedIdRecoveryRegistered(task.sourceId)) {
    contractFailures++;
    candidates.push({ ...common, outcome: "rejected", reason: "direct_fixed_id_handler_missing" });
    continue;
  }
  runnable.push({ task, saved });
}
if (runnable.length > maxRequests) throw new Error(`targeted_detail_request_limit:${runnable.length}:${maxRequests}`);

const consecutiveSourceFailures = new Map();
for (const { task, saved } of runnable) {
  const common = {
    version: 1, market, sourceId: task.sourceId, offerId: task.offerId,
    sourceOfferId: task.sourceOfferId, inputRevisionHash: task.inputRevisionHash,
    requestedNeeds: task.actionableNeeds,
  };
  const sourceFailures = Number(consecutiveSourceFailures.get(task.sourceId) || 0);
  if (sourceFailures >= sourceFailureLimit) {
    unresolved++;
    candidates.push({ ...common, outcome: "unresolved", reason: `source_circuit_open_after_${sourceFailures}_failures` });
    continue;
  }
  attempted++;
  try {
    const recovered = await recoverSavedDetailCandidate(saved.observation.offer, task.actionableNeeds);
    let offer;
    try {
      offer = validateEnrichedDetail(saved.observation.offer, recovered, task.actionableNeeds);
    } catch (error) {
      contractFailures++;
      candidates.push({ ...common, outcome: "rejected", reason: String(error?.message || error).slice(0, 300) });
      continue;
    }
    candidates.push({ ...common, outcome: "candidate", offer });
    succeeded++;
    consecutiveSourceFailures.set(task.sourceId, 0);
  } catch (error) {
    const reason = String(error?.message || error).slice(0, 300);
    if (isContractFailure(error)) {
      contractFailures++;
      candidates.push({ ...common, outcome: "rejected", reason });
    } else {
      // A single source can be temporarily unavailable, sold, blocked, or
      // still lack an exact field. Keep that ID unresolved while preserving
      // successful candidates from the same bounded run.
      unresolved++;
      candidates.push({ ...common, outcome: "unresolved", reason });
      consecutiveSourceFailures.set(task.sourceId, sourceFailures + 1);
    }
  } finally {
    if (attempted < runnable.length) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(path.dirname(reportFile), { recursive: true });
await fs.writeFile(output, candidates.map((row) => JSON.stringify(row)).join("\n") + (candidates.length ? "\n" : ""));
const report = {
  version: 1,
  phase: "bounded_fixed_id_candidate_fetch",
  market,
  productionWrites: false,
  listRequests: 0,
  queued: tasks.length,
  runnable: runnable.length,
  requestLimit: maxRequests,
  sourceFailureLimit,
  sequential: true,
  minimumDelayMs: delayMs,
  attempted,
  succeeded,
  unresolved,
  contractFailures,
  complete: unresolved === 0 && contractFailures === 0,
  hasEnrichedCandidates: succeeded > 0,
  ledger: candidates.map(({ offer, ...entry }) => entry),
};
await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, ledger: report.ledger.slice(0, 10) }));
if (contractFailures) process.exitCode = 1;
