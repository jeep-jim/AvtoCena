import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { readCheckpointJsonl } from "./read-checkpoint-jsonl.mjs";

function revisionHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function checkpointFiles(input) {
  const stat = await fs.stat(input);
  if (stat.isFile()) {
    if (!input.endsWith(".jsonl")) throw new Error(`saved_artifact_not_jsonl:${input}`);
    return [input];
  }
  if (!stat.isDirectory()) throw new Error(`saved_artifact_invalid_input:${input}`);
  return (await fs.readdir(input))
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => path.join(input, name));
}

export async function readSavedArtifactReport(input, market) {
  const stat = await fs.stat(input);
  if (!stat.isDirectory()) return null;
  let report;
  try { report = JSON.parse(await fs.readFile(path.join(input, "report.json"), "utf8")); }
  catch (error) { throw new Error(`saved_artifact_report_invalid:${error?.message || error}`); }
  if (report?.market !== market || report?.productionWrites !== false || report?.mode !== "source_observations") {
    throw new Error("saved_artifact_report_safety_contract");
  }
  return report;
}

/**
 * Replays the immutable source artifact in the same deterministic order as the
 * publication converter and keeps only the latest revision for each source ID.
 */
export async function readLatestSavedObservations(input, market) {
  await readSavedArtifactReport(input, market);
  const files = await checkpointFiles(input);
  if (!files.length) throw new Error(`saved_artifact_empty:${input}`);
  const latest = new Map();
  let revisions = 0;
  for (const file of files) {
    for await (const observation of readCheckpointJsonl(file)) {
      revisions++;
      if (observation?.version !== 1 || !["listing", "detail"].includes(observation?.stage)
        || observation?.publicationReady !== false || !observation?.offer?.id || !observation?.offer?.sourceId) {
        throw new Error(`saved_artifact_invalid_observation:${path.basename(file)}:${revisions}`);
      }
      if (observation.offer.market !== market) {
        throw new Error(`saved_artifact_cross_market:${observation.offer.market}:${market}`);
      }
      const key = `${observation.offer.sourceId}\u0000${observation.offer.id}`;
      latest.set(key, {
        observation,
        revisionHash: revisionHash(observation),
        filename: path.basename(file),
        revision: revisions,
      });
    }
  }
  return {
    files: files.map((file) => path.basename(file)),
    revisions,
    latest: [...latest.values()].sort((left, right) => {
      const source = String(left.observation.offer.sourceId).localeCompare(String(right.observation.offer.sourceId));
      return source || String(left.observation.offer.id).localeCompare(String(right.observation.offer.id));
    }),
  };
}
