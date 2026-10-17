import crypto from "node:crypto";
import fs from "node:fs/promises";

const { getJsonStorage, mutateDataJson } = await import("../apps/web/lib/data.ts");
const {
  persistCatalogOffers,
  readAllOffersForMaintenance,
  readMarketOffers,
} = await import("../apps/web/lib/catalog/storage.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const output = String(process.env.CATALOG_ACTIVE_MARKETS_REPORT || "catalog-active-markets-report.json");
const requireRetiredMarket = !/^(?:0|false|no)$/i.test(String(process.env.CATALOG_REQUIRE_RETIRED_MARKET || "true"));
const lockPath = "catalog/import-lock.json";
const operationId = `catalog_republish_active_markets_${crypto.randomUUID()}`;
const waitMs = Math.max(0, Number(process.env.CATALOG_PUBLISH_LOCK_WAIT_MS || 7_200_000));
const pollMs = Math.max(1_000, Number(process.env.CATALOG_PUBLISH_LOCK_POLL_MS || 15_000));
const ttlMs = Math.max(30 * 60_000, Number(process.env.CATALOG_PUBLISH_LOCK_TTL_MS || 90 * 60_000));
let lockHeld = false;

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJsonValue(value[key])]));
  }
  return value;
}

function hashRows(rows) {
  const canonical = [...rows]
    .sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")))
    .map(stableJsonValue);
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock() {
  const deadline = Date.now() + waitMs;
  let lastError = "catalog_import_locked";
  while (true) {
    try {
      await mutateDataJson(lockPath, { lockedUntil: "" }, (current) => {
        const lockedUntil = Date.parse(String(current?.lockedUntil || ""));
        if (Number.isFinite(lockedUntil) && lockedUntil > Date.now() && current?.operationId !== operationId) {
          throw new Error(`catalog_import_locked_until_${new Date(lockedUntil).toISOString()}`);
        }
        return {
          operationId,
          operationType: "republish_active_markets",
          lockedUntil: new Date(Date.now() + ttlMs).toISOString(),
          startedAt: new Date().toISOString(),
        };
      });
      lockHeld = true;
      return;
    } catch (error) {
      lastError = String(error?.message || error);
      if (!/catalog_(?:publish|import|certified_power)_locked/i.test(lastError) || Date.now() + pollMs > deadline) {
        throw new Error(`catalog_active_markets_lock_wait_failed:${lastError}`);
      }
      console.log(`[active-markets] waiting for writer lock: ${lastError}`);
      await sleep(pollMs);
    }
  }
}

async function releaseLock() {
  if (!lockHeld) return;
  await mutateDataJson(lockPath, { lockedUntil: "" }, (current) => current?.operationId === operationId
    ? { operationId, operationType: "republish_active_markets", lockedUntil: "", finishedAt: new Date().toISOString() }
    : current);
  lockHeld = false;
}

const storage = getJsonStorage();
await acquireLock();
try {
  const beforeManifest = await storage.readJson("catalog/manifest.json", { version: 2, generationId: "", markets: {} });
  const beforeMarketIds = Object.keys(beforeManifest?.markets || {});
  const retiredMarketIds = beforeMarketIds.filter((market) => !PUBLIC_CATALOG_MARKETS.includes(market));
  if (requireRetiredMarket && retiredMarketIds.length === 0) throw new Error("catalog_active_markets_no_retired_market");

  const preservedPublicOffersByMarket = {};
  const expectedCounts = {};
  const expectedHashes = {};
  for (const market of PUBLIC_CATALOG_MARKETS) {
    const rows = await readMarketOffers(market);
    const manifestCount = Number(beforeManifest?.markets?.[market]?.count || 0);
    if (rows.length === 0 || rows.length !== manifestCount) {
      throw new Error(`catalog_active_markets_snapshot_mismatch:${market}:${rows.length}:${manifestCount}`);
    }
    preservedPublicOffersByMarket[market] = rows;
    expectedCounts[market] = rows.length;
    expectedHashes[market] = hashRows(rows);
  }

  const maintenance = (await readAllOffersForMaintenance())
    .filter((offer) => PUBLIC_CATALOG_MARKETS.includes(String(offer?.market || "")));
  process.env.CATALOG_GROW_ONLY_MARKETS = "";
  const validateExactSnapshot = (rows, phase) => {
    const failures = [];
    for (const market of PUBLIC_CATALOG_MARKETS) {
      const marketRows = rows.filter((offer) => String(offer?.market || "") === market);
      if (marketRows.length !== expectedCounts[market]) failures.push(`${market}:count:${marketRows.length}:${expectedCounts[market]}`);
      if (hashRows(marketRows) !== expectedHashes[market]) failures.push(`${market}:hash`);
    }
    const unexpected = [...new Set(rows.map((offer) => String(offer?.market || "")).filter((market) => !PUBLIC_CATALOG_MARKETS.includes(market)))];
    if (unexpected.length) failures.push(`unexpected:${unexpected.join(",")}`);
    if (failures.length) throw new Error(`catalog_active_markets_${phase}_mismatch:${failures.join("|")}`);
  };

  const manifest = await persistCatalogOffers(maintenance, {
    preservePublicOffersByMarket: preservedPublicOffersByMarket,
    beforePersistValidate(rows) { validateExactSnapshot(rows, "prewrite"); },
    beforePublishValidate(rows) { validateExactSnapshot(rows, "public"); },
  });

  const afterMarketIds = Object.keys(manifest?.markets || {}).sort();
  const expectedMarketIds = [...PUBLIC_CATALOG_MARKETS].sort();
  if (JSON.stringify(afterMarketIds) !== JSON.stringify(expectedMarketIds)) {
    throw new Error(`catalog_active_markets_manifest_mismatch:${afterMarketIds.join(",")}:${expectedMarketIds.join(",")}`);
  }

  const afterCounts = {};
  const afterHashes = {};
  for (const market of PUBLIC_CATALOG_MARKETS) {
    const rows = await readMarketOffers(market);
    afterCounts[market] = rows.length;
    afterHashes[market] = hashRows(rows);
    if (afterCounts[market] !== expectedCounts[market] || afterHashes[market] !== expectedHashes[market]) {
      throw new Error(`catalog_active_markets_postwrite_mismatch:${market}:${afterCounts[market]}:${expectedCounts[market]}`);
    }
  }

  const report = {
    version: 1,
    mode: "republish_active_markets",
    beforeGenerationId: beforeManifest.generationId,
    generationId: manifest.generationId,
    activeMarkets: [...PUBLIC_CATALOG_MARKETS],
    retiredMarketIds,
    expectedCounts,
    afterCounts,
    expectedHashes,
    afterHashes,
    failures: [],
  };
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await releaseLock();
}
