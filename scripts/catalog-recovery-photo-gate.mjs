import fs from "node:fs/promises";

const market = String(process.env.RECOVERY_PHOTO_GATE_MARKET || "").trim();
const input = String(process.env.RECOVERY_PHOTO_GATE_INPUT || "").trim();
const dryRunReport = String(process.env.RECOVERY_PHOTO_GATE_DRY_RUN_REPORT || "").trim();
const output = String(process.env.RECOVERY_PHOTO_GATE_REPORT || "catalog-recovery-photo-gate-report.json").trim();
const requestedMinimum = Number(process.env.RECOVERY_MIN_IMAGES_PER_OFFER || process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5);
const minimumImages = Number.isFinite(requestedMinimum) ? Math.max(1, Math.min(30, Math.trunc(requestedMinimum))) : 5;

if (!market) throw new Error("recovery_photo_gate_market_required");
if (!input && !dryRunReport) throw new Error("recovery_photo_gate_input_required");
if (input && dryRunReport) throw new Error("recovery_photo_gate_choose_one_input");

function imageCount(offer) {
  const seen = new Set();
  for (const value of Array.isArray(offer?.images) ? offer.images : []) {
    const url = String(value || "").trim();
    if (/^https?:\/\//i.test(url)) seen.add(url);
  }
  return seen.size;
}

if (dryRunReport) {
  const payload = JSON.parse(await fs.readFile(dryRunReport, "utf8"));
  const reportMarket = payload?.byMarket?.[market];
  if (!payload?.dryRun || !reportMarket) throw new Error(`recovery_photo_gate_dry_run_market_missing:${market}`);
  const min = Number(reportMarket?.imageStats?.min ?? 0);
  const report = {
    version: 1,
    mode: "recovery_dry_run_photo_gate",
    market,
    minimumImages,
    selectedCount: Number(reportMarket?.count || 0),
    observedMinimum: min,
    passed: Number(reportMarket?.count || 0) > 0 && min >= minimumImages,
  };
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) throw new Error(`recovery_photo_gate_failed:${market}:${min}<${minimumImages}`);
  process.exit(0);
}

const payload = JSON.parse(await fs.readFile(input, "utf8"));
const rows = Array.isArray(payload?.offers) ? payload.offers : [];
const scoped = rows.filter((offer) => String(offer?.market || "").trim() === market);
const foreign = rows.length - scoped.length;
const below = scoped.filter((offer) => imageCount(offer) < minimumImages);
const sourceStats = {};
for (const offer of scoped) {
  const sourceId = String(offer?.sourceId || "unknown");
  const count = imageCount(offer);
  const entry = sourceStats[sourceId] || { count: 0, belowMinimum: 0, min: null, max: 0 };
  entry.count += 1;
  if (count < minimumImages) entry.belowMinimum += 1;
  entry.min = entry.min === null ? count : Math.min(entry.min, count);
  entry.max = Math.max(entry.max, count);
  sourceStats[sourceId] = entry;
}
const report = {
  version: 1,
  mode: "recovery_input_photo_gate",
  market,
  minimumImages,
  totalRows: rows.length,
  marketRows: scoped.length,
  foreignRows: foreign,
  belowMinimum: below.length,
  passed: scoped.length > 0 && foreign === 0 && below.length === 0,
  sourceStats,
  sampleBelowMinimum: below.slice(0, 20).map((offer) => ({
    id: String(offer?.sourceOfferId || offer?.id || ""),
    sourceId: String(offer?.sourceId || "unknown"),
    images: imageCount(offer),
  })),
};
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) throw new Error(`recovery_photo_gate_failed:${market}:foreign=${foreign}:below=${below.length}:min=${minimumImages}`);
