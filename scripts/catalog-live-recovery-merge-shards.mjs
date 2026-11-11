import fs from "node:fs/promises";
import path from "node:path";

const market = String(process.env.RECOVERY_MERGE_MARKET || "").trim();
const inputDir = String(process.env.RECOVERY_MERGE_INPUT_DIR || "catalog-shards").trim();
const output = String(process.env.RECOVERY_MERGE_OUTPUT || `catalog-rebuild-${market}.json`).trim();
if (!market) throw new Error("recovery_merge_market_missing");

async function filesUnder(dir) {
  const result = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".json")) result.push(full);
    }
  }
  await walk(dir);
  return result;
}

function quality(offer) {
  return [
    Number(offer?.images?.length || 0),
    Date.parse(String(offer?.updatedAt || offer?.firstSeenAt || "")) || 0,
    Number(offer?.year || 0),
  ];
}
function better(a, b) {
  const qa = quality(a), qb = quality(b);
  for (let i = 0; i < qa.length; i++) if (qa[i] !== qb[i]) return qa[i] > qb[i] ? a : b;
  return a;
}

const files = await filesUnder(inputDir);
const offers = new Map();
const shardReports = [];
for (const file of files) {
  let payload;
  try { payload = JSON.parse(await fs.readFile(file, "utf8")); } catch { continue; }
  const rows = Array.isArray(payload?.offers) ? payload.offers : [];
  let accepted = 0;
  const sources = new Set();
  for (const offer of rows) {
    if (!offer?.id || String(offer.market || "") !== market) continue;
    sources.add(String(offer.sourceId || "unknown"));
    const existing = offers.get(offer.id);
    offers.set(offer.id, existing ? better(existing, offer) : offer);
    accepted++;
  }
  if (rows.length) shardReports.push({ file, rows: rows.length, accepted, sources: [...sources] });
}

const merged = [...offers.values()];
if (!merged.length) throw new Error(`recovery_merge_empty:${market}`);
const report = {
  version: 1,
  mode: "source_shard_merge",
  market,
  files: shardReports.length,
  inputRows: shardReports.reduce((sum, row) => sum + row.rows, 0),
  count: merged.length,
  sourceCounts: Object.fromEntries([...new Set(merged.map((offer) => String(offer.sourceId || "unknown")))].sort().map((sourceId) => [sourceId, merged.filter((offer) => String(offer.sourceId || "unknown") === sourceId).length])),
  shards: shardReports,
};
await fs.writeFile(output, JSON.stringify({ offers: merged, report }, null, 2));
console.log(JSON.stringify(report, null, 2));
