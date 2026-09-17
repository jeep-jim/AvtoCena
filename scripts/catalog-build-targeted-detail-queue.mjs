import fs from "node:fs/promises";
import path from "node:path";
import {
  deriveSavedDetailNeeds,
  detailRecoveryCapability,
  SAVED_DETAIL_RECOVERY_MARKETS,
} from "../apps/web/lib/catalog/saved-detail-recovery.ts";
import { readLatestSavedObservations } from "./lib/catalog-saved-artifact.mjs";

const input = String(process.env.CATALOG_TARGETED_DETAIL_INPUT || "").trim();
const market = String(process.env.CATALOG_TARGETED_DETAIL_MARKET || "").trim();
const output = String(process.env.CATALOG_TARGETED_DETAIL_OUTPUT || "targeted-detail-queue.jsonl").trim();
const reportFile = String(process.env.CATALOG_TARGETED_DETAIL_REPORT || `${output}.report.json`).trim();

if (!input) throw new Error("targeted_detail_input_required");
if (!SAVED_DETAIL_RECOVERY_MARKETS.includes(market)) throw new Error(`targeted_detail_market_invalid:${market}`);
if (!output || !reportFile || output === reportFile) throw new Error("targeted_detail_output_invalid");

const artifact = await readLatestSavedObservations(input, market);
const queue = [];
const counts = {
  needs: {},
  actionable: {},
  skipped: {},
  transports: {},
};
const increment = (group, key) => { group[key] = Number(group[key] || 0) + 1; };

for (const saved of artifact.latest) {
  const { observation } = saved;
  const offer = observation.offer;
  const needs = deriveSavedDetailNeeds(offer, observation.stage);
  for (const need of needs) increment(counts.needs, need);
  const decision = detailRecoveryCapability(offer, needs, observation.stage);
  for (const need of decision.actionable) increment(counts.actionable, need);
  for (const skipped of decision.skipped) increment(counts.skipped, skipped.reason);
  increment(counts.transports, decision.transport);
  if (!decision.actionable.length) continue;
  queue.push({
    version: 1,
    market,
    sourceId: offer.sourceId,
    offerId: offer.id,
    sourceOfferId: offer.sourceOfferId,
    sourceUrl: offer.operational?.sourceUrl || null,
    latestStage: observation.stage,
    inputRevisionHash: saved.revisionHash,
    needs,
    actionableNeeds: decision.actionable,
    skipped: decision.skipped,
    transport: decision.transport,
    runnable: decision.runnable,
  });
}

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(path.dirname(reportFile), { recursive: true });
await fs.writeFile(output, queue.map((row) => JSON.stringify(row)).join("\n") + (queue.length ? "\n" : ""));
const report = {
  version: 1,
  phase: "saved_artifact_targeted_detail_queue",
  market,
  productionWrites: false,
  networkRequests: 0,
  sourceFiles: artifact.files,
  revisions: artifact.revisions,
  latestOffers: artifact.latest.length,
  queued: queue.length,
  runnable: queue.filter((row) => row.runnable).length,
  fixedIdBridgeRequired: queue.filter((row) => row.transport === "fixed_id_bridge_required").length,
  counts,
};
await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
