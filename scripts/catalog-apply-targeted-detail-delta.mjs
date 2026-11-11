import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { readCheckpointJsonl } from "./lib/read-checkpoint-jsonl.mjs";
import { readLatestSavedObservations } from "./lib/catalog-saved-artifact.mjs";
import { deriveSavedDetailNeeds, detailRecoveryCapability, validateEnrichedDetail, SAVED_DETAIL_RECOVERY_MARKETS } from "../apps/web/lib/catalog/saved-detail-recovery.ts";
import { sourceListingSnapshot } from "../apps/web/lib/catalog/source-listing-snapshot.ts";

const baseInput = String(process.env.CATALOG_TARGETED_DETAIL_BASE || "").trim();
const queueInput = String(process.env.CATALOG_TARGETED_DETAIL_QUEUE || "").trim();
const candidateInput = String(process.env.CATALOG_TARGETED_DETAIL_CANDIDATES || "").trim();
const market = String(process.env.CATALOG_TARGETED_DETAIL_MARKET || "").trim();
const output = String(process.env.CATALOG_TARGETED_DETAIL_DELTA_OUTPUT || "targeted-detail-delta.jsonl").trim();
const reportFile = String(process.env.CATALOG_TARGETED_DETAIL_DELTA_REPORT || `${output}.report.json`).trim();

if (!baseInput || !queueInput || !candidateInput) throw new Error("targeted_detail_delta_inputs_required");
if (!SAVED_DETAIL_RECOVERY_MARKETS.includes(market)) throw new Error(`targeted_detail_market_invalid:${market}`);
if (!output || !reportFile || output === reportFile) throw new Error("targeted_detail_delta_output_invalid");

const base = await readLatestSavedObservations(baseInput, market);
const baseById = new Map(base.latest.map((row) => [`${row.observation.offer.sourceId}\u0000${row.observation.offer.id}`, row]));
const queues = new Map();
for await (const row of readCheckpointJsonl(queueInput)) {
  if (row?.version !== 1 || row?.market !== market || !row?.sourceId || !row?.offerId || !row?.sourceOfferId
    || !row?.sourceUrl || !["listing", "detail"].includes(row?.latestStage)
    || !Array.isArray(row?.needs) || !Array.isArray(row?.actionableNeeds) || !row.actionableNeeds.length || !row?.inputRevisionHash) {
    throw new Error("targeted_detail_queue_invalid");
  }
  const key = `${row.sourceId}\u0000${row.offerId}`;
  if (queues.has(key)) throw new Error(`targeted_detail_queue_duplicate:${row.offerId}`);
  queues.set(key, row);
}

const candidates = new Map();
for await (const row of readCheckpointJsonl(candidateInput)) {
  if (row?.version !== 1 || row?.market !== market || !row?.sourceId || !row?.offerId || !row?.sourceOfferId
    || !row?.inputRevisionHash || !Array.isArray(row?.requestedNeeds)
    || !["candidate", "unresolved", "rejected"].includes(row?.outcome)) {
    throw new Error("targeted_detail_candidate_invalid");
  }
  const key = `${row.sourceId}\u0000${row.offerId}`;
  if (candidates.has(key)) throw new Error(`targeted_detail_candidate_duplicate:${row.offerId}`);
  candidates.set(key, row);
}
const candidateCount = candidates.size;

const delta = [];
const ledger = [];
let invalid = 0;
let unresolved = 0;
for (const [key, task] of queues) {
  const saved = baseById.get(key);
  const candidate = candidates.get(key);
  const entry = {
    market,
    sourceId: task.sourceId,
    offerId: task.offerId,
    sourceOfferId: task.sourceOfferId,
    inputRevisionHash: task.inputRevisionHash,
    requestedNeeds: task.actionableNeeds,
    transport: task.transport,
  };
  if (!saved || saved.revisionHash !== task.inputRevisionHash) {
    invalid++;
    ledger.push({ ...entry, outcome: "rejected", reason: "base_revision_hash_mismatch" });
    continue;
  }
  const expectedNeeds = deriveSavedDetailNeeds(saved.observation.offer, saved.observation.stage);
  const decision = detailRecoveryCapability(saved.observation.offer, expectedNeeds, saved.observation.stage);
  if (String(saved.observation.offer.sourceOfferId || "") !== String(task.sourceOfferId)
    || task.latestStage !== saved.observation.stage
    || String(task.sourceUrl) !== String(saved.observation.offer.operational?.sourceUrl || "")
    || JSON.stringify(task.needs) !== JSON.stringify(expectedNeeds)
    || decision.transport !== task.transport || decision.runnable !== task.runnable
    || JSON.stringify(decision.actionable) !== JSON.stringify(task.actionableNeeds)) {
    invalid++;
    ledger.push({ ...entry, outcome: "rejected", reason: "queue_capability_or_identity_mismatch" });
    continue;
  }
  if (!candidate) {
    const reason = task.runnable ? "runnable_candidate_missing" : "fixed_id_bridge_candidate_missing";
    unresolved++;
    ledger.push({ ...entry, outcome: "unresolved", reason });
    continue;
  }
  candidates.delete(key);
  if (candidate.inputRevisionHash !== task.inputRevisionHash
    || String(candidate.sourceOfferId) !== String(task.sourceOfferId)
    || JSON.stringify(candidate.requestedNeeds) !== JSON.stringify(task.actionableNeeds)) {
    invalid++;
    ledger.push({ ...entry, outcome: "rejected", reason: "candidate_revision_hash_mismatch" });
    continue;
  }
  if (candidate.outcome === "unresolved") {
    unresolved++;
    ledger.push({ ...entry, outcome: "unresolved", reason: String(candidate.reason || "fixed_id_detail_unresolved").slice(0, 300) });
    continue;
  }
  if (candidate.outcome !== "candidate" || !candidate.offer) {
    invalid++;
    ledger.push({ ...entry, outcome: "rejected", reason: String(candidate.reason || "candidate_offer_missing").slice(0, 300) });
    continue;
  }
  try {
    const offer = validateEnrichedDetail(saved.observation.offer, candidate.offer, task.actionableNeeds);
    const observation = sourceListingSnapshot(offer, "detail");
    delta.push(observation);
    ledger.push({
      ...entry,
      outcome: "enriched",
      outputRevisionHash: crypto.createHash("sha256").update(JSON.stringify(observation)).digest("hex"),
    });
  } catch (error) {
    invalid++;
    ledger.push({ ...entry, outcome: "rejected", reason: String(error?.message || error).slice(0, 300) });
  }
}
for (const candidate of candidates.values()) {
  invalid++;
  ledger.push({
    market,
    sourceId: candidate.sourceId,
    offerId: candidate.offerId,
    inputRevisionHash: candidate.inputRevisionHash,
    outcome: "rejected",
    reason: "candidate_not_in_queue",
  });
}

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(path.dirname(reportFile), { recursive: true });
await fs.writeFile(output, delta.map((row) => JSON.stringify(row)).join("\n") + (delta.length ? "\n" : ""));
const report = {
  version: 1,
  phase: "targeted_fixed_id_detail_delta",
  market,
  productionWrites: false,
  networkRequests: 0,
  baseRevisions: base.revisions,
  baseLatestOffers: base.latest.length,
  queued: queues.size,
  candidates: candidateCount,
  enriched: delta.length,
  unresolved,
  invalid,
  complete: unresolved === 0 && invalid === 0,
  targetMet: delta.length > 0 && invalid === 0,
  ledger,
};
await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, ledger: undefined }));
if (invalid) process.exitCode = 1;
