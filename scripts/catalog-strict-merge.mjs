import fs from "node:fs/promises";
import path from "node:path";

const inputDir = process.env.CATALOG_STRICT_MERGE_INPUT_DIR || "catalog-strict-input";
const output = process.env.CATALOG_STRICT_MERGE_OUTPUT || "catalog-strict-merged.json";
const market = String(process.env.CATALOG_STRICT_MARKET || "").trim();
const sourceId = String(process.env.CATALOG_STRICT_SOURCE_ID || "").trim();
const target = Math.max(1, Math.min(30_000, Number(process.env.CATALOG_STRICT_TARGET || 30_000)));
const expectedChunks = Math.max(1, Number(process.env.CATALOG_STRICT_EXPECTED_CHUNKS || 1));
const strictMode = "strict_exact_source_only_no_publish_no_generic_normalization";

if (!market) throw new Error("strict_merge_market_missing");
if (!sourceId) throw new Error("strict_merge_source_missing");

const names = (await fs.readdir(inputDir)).filter((name) => name.endsWith(".json"));
const reports = [];
for (const name of names) {
  const file = path.join(inputDir, name);
  const report = JSON.parse(await fs.readFile(file, "utf8"));
  if (report?.mode !== strictMode) continue;
  if (report?.market !== market || report?.sourceId !== sourceId) continue;
  reports.push({ file: name, ...report });
}

reports.sort((a, b) => Number(a.startCursor || 1) - Number(b.startCursor || 1));
if (reports.length !== expectedChunks) {
  throw new Error(`strict_merge_chunk_count:${reports.length}/${expectedChunks}`);
}

const unique = new Map();
const conflicts = [];
let acceptedRaw = 0;
let rejected = 0;
let rowsSeen = 0;
let pages = 0;
const rejectionReasons = {};
const chunkSummary = [];

for (const report of reports) {
  if (report.passed !== true) throw new Error(`strict_merge_failed_chunk:${report.file}`);
  const cards = Array.isArray(report.cards) ? report.cards : [];
  if (Number(report.accepted || 0) !== cards.length) throw new Error(`strict_merge_accepted_mismatch:${report.file}`);
  acceptedRaw += cards.length;
  rejected += Number(report.rejected || 0);
  rowsSeen += Number(report.rowsSeen || 0);
  pages += Number(report.pages || 0);
  for (const [reason, count] of Object.entries(report.rejectionReasons || {})) {
    rejectionReasons[reason] = Number(rejectionReasons[reason] || 0) + Number(count || 0);
  }
  chunkSummary.push({
    file: report.file,
    startCursor: report.startCursor,
    nextCursor: report.nextCursor,
    pages: report.pages,
    rowsSeen: report.rowsSeen,
    accepted: report.accepted,
    rejected: report.rejected,
    sourceFinished: report.sourceFinished === true,
  });

  for (const card of cards) {
    if (!card?.id || !card?.sourceOfferId || !/^https?:\/\//i.test(String(card?.sourceUrl || ""))) {
      throw new Error(`strict_merge_invalid_identity:${report.file}`);
    }
    const failedChecks = Object.entries(card?.checks || {}).filter(([, ok]) => ok !== true).map(([name]) => name);
    if (failedChecks.length) throw new Error(`strict_merge_failed_card:${card.id}:${failedChecks.join(",")}`);
    const key = `${sourceId}:${card.sourceOfferId}`;
    const previous = unique.get(key);
    if (previous) {
      if (String(previous.id) !== String(card.id) || String(previous.sourceUrl) !== String(card.sourceUrl)) {
        conflicts.push({ key, leftId: previous.id, rightId: card.id, leftUrl: previous.sourceUrl, rightUrl: card.sourceUrl });
      }
      continue;
    }
    unique.set(key, card);
  }
}

if (conflicts.length) throw new Error(`strict_merge_identity_conflicts:${conflicts.length}`);
const uniqueCards = [...unique.values()];
const passed = uniqueCards.length >= target;
const report = {
  version: 1,
  mode: "strict_exact_source_only_merged_certification_no_publish",
  checkedAt: new Date().toISOString(),
  sourceMode: strictMode,
  market,
  sourceId,
  target,
  expectedChunks,
  chunks: reports.length,
  pages,
  rowsSeen,
  acceptedRaw,
  duplicates: acceptedRaw - uniqueCards.length,
  uniqueAccepted: uniqueCards.length,
  rejected,
  rejectionReasons,
  identityConflicts: conflicts.length,
  chunkSummary,
  cards: uniqueCards.slice(0, target),
  passed,
};

await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  mode: report.mode,
  market,
  sourceId,
  target,
  chunks: report.chunks,
  pages,
  rowsSeen,
  acceptedRaw,
  duplicates: report.duplicates,
  uniqueAccepted: report.uniqueAccepted,
  rejected,
  identityConflicts: report.identityConflicts,
  passed,
}, null, 2));
if (!passed) process.exit(1);
