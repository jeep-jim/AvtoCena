import fs from "node:fs/promises";
import { spawn } from "node:child_process";

// Production trigger: rerun the six-market accumulating collector after the retry fix.
const market = String(process.env.CATALOG_REBUILD_MARKET || "").trim();
const target = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET || 250));
const outputFile = process.env.CATALOG_REBUILD_OUTPUT || `catalog-rebuild-${market}.json`;
const configuredSourceIds = String(process.env.CATALOG_REBUILD_SOURCE_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const attemptCount = Math.max(2, Math.min(4, Number(process.env.CATALOG_REBUILD_ATTEMPTS || 3)));
const totalBudgetMs = Math.max(15 * 60_000, Number(process.env.CATALOG_REBUILD_RETRY_BUDGET_MS || 84 * 60_000));
const attemptBudgetMs = Math.max(8 * 60_000, Math.floor(totalBudgetMs / attemptCount));

if (!market) throw new Error("catalog_retry_market_missing");

function freshness(offer) {
  return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0;
}

function qualityOrder(left, right) {
  return freshness(right) - freshness(left)
    || Number(right?.images?.length || 0) - Number(left?.images?.length || 0)
    || String(left?.id || "").localeCompare(String(right?.id || ""));
}

function validOffer(offer) {
  return Boolean(
    offer?.id
    && offer?.market === market
    && Number(offer?.totalRub || 0) > 0
    && Array.isArray(offer?.images)
    && offer.images.length >= Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 4))
  );
}

function rotated(values, offset) {
  if (!values.length) return [];
  const shift = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(shift), ...values.slice(0, shift)];
}

function sourcePlan(attempt) {
  if (attempt === 1) return configuredSourceIds;
  if (attempt === 2) return [];
  return rotated(configuredSourceIds, attempt - 1).reverse();
}

async function runCollector(env) {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "scripts/catalog-rebuild-market.mjs"], {
      stdio: "inherit",
      env,
      shell: process.platform === "win32",
    });
    child.on("error", (error) => resolve({ code: 1, error: String(error?.message || error) }));
    child.on("exit", (code, signal) => resolve({ code: Number(code ?? 1), signal: signal || null }));
  });
}

async function readPayload(filename) {
  try {
    const payload = JSON.parse(await fs.readFile(filename, "utf8"));
    return payload && Array.isArray(payload.offers) ? payload : null;
  } catch {
    return null;
  }
}

const accumulated = new Map();
const attempts = [];

// Если job был перезапущен GitHub или управляющий скрипт запускается повторно в том же
// workspace, не теряем уже собранные и проверенные карточки.
const existing = await readPayload(outputFile);
for (const offer of existing?.offers || []) {
  if (validOffer(offer)) accumulated.set(offer.id, offer);
}

for (let attempt = 1; attempt <= attemptCount && accumulated.size < target; attempt++) {
  const attemptFile = `${outputFile}.attempt-${attempt}.json`;
  const sources = sourcePlan(attempt);
  await fs.rm(attemptFile, { force: true });

  const env = {
    ...process.env,
    CATALOG_REBUILD_OUTPUT: attemptFile,
    CATALOG_REBUILD_SOURCE_IDS: sources.join(","),
    CATALOG_REBUILD_TIME_LIMIT_MS: String(attemptBudgetMs),
    CATALOG_REBUILD_MAX_EMPTY_PAGES: String(Math.max(
      Number(process.env.CATALOG_REBUILD_MAX_EMPTY_PAGES || 12),
      attempt === 1 ? 12 : attempt === 2 ? 40 : 120,
    )),
    CATALOG_REBUILD_MAX_TOTAL_PAGES: String(Math.max(
      Number(process.env.CATALOG_REBUILD_MAX_TOTAL_PAGES || 1200),
      attempt * 1200,
    )),
  };

  console.log(`\n[retry:${market}] attempt ${attempt}/${attemptCount}; accumulated=${accumulated.size}/${target}; sources=${sources.length ? sources.join(",") : "all_registered"}`);
  const result = await runCollector(env);
  const payload = await readPayload(attemptFile);
  const before = accumulated.size;
  for (const offer of payload?.offers || []) {
    if (!validOffer(offer)) continue;
    const previous = accumulated.get(offer.id);
    if (!previous || qualityOrder(offer, previous) < 0) accumulated.set(offer.id, offer);
  }

  attempts.push({
    attempt,
    sources: sources.length ? sources : ["all_registered"],
    childExitCode: result.code,
    childSignal: result.signal || null,
    childError: result.error || null,
    childCount: payload?.offers?.length || 0,
    added: accumulated.size - before,
    accumulated: accumulated.size,
    childStopReason: payload?.stopReason || payload?.report?.stopReason || "missing_payload",
    childReport: payload?.report || null,
  });

  const offers = [...accumulated.values()].sort(qualityOrder).slice(0, target);
  const bySource = offers.reduce((totals, offer) => {
    totals[offer.sourceId || "unknown"] = Number(totals[offer.sourceId || "unknown"] || 0) + 1;
    return totals;
  }, {});
  const targetReached = offers.length >= target;
  const merged = {
    version: 9,
    market,
    generatedAt: new Date().toISOString(),
    target,
    count: offers.length,
    sourceIds: [...new Set(attempts.flatMap((row) => row.sources))],
    partial: !targetReached,
    stopReason: targetReached ? "target_reached_after_retry" : "retry_in_progress",
    report: {
      market,
      target,
      saved: offers.length,
      targetReached,
      attempts,
      publicBySource: bySource,
      retryArchitecture: "accumulate_unique_offers_across_attempts",
    },
    offers,
  };
  const temporary = `${outputFile}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(merged, null, 2));
  await fs.rename(temporary, outputFile);

  console.log(`[retry:${market}] attempt ${attempt} finished; child=${payload?.offers?.length || 0}; added=${accumulated.size - before}; accumulated=${offers.length}/${target}`);
}

const finalPayload = await readPayload(outputFile);
const finalCount = finalPayload?.offers?.filter(validOffer).length || 0;
if (finalCount < target) {
  console.error(`[retry:${market}] exhausted ${attemptCount} attempts with ${finalCount}/${target}`);
  process.exitCode = 2;
} else {
  console.log(`[retry:${market}] target reached: ${finalCount}/${target}`);
}
