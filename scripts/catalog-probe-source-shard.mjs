import fs from "node:fs/promises";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { requiredCatalogSourceIds } = await import("../apps/web/lib/catalog/required-catalog-sources.ts");
const { catalogSourceAssignedToShard } = await import("../apps/web/lib/catalog/source-page-partition.ts");

const market = String(process.env.CATALOG_REBUILD_MARKET || "").trim();
const shardIndex = Math.max(0, Number(process.env.CATALOG_REBUILD_SHARD_INDEX || 0));
const shardCount = Math.max(1, Number(process.env.CATALOG_REBUILD_SHARD_COUNT || 1));
const timeoutMs = Math.max(3_000, Number(process.env.CATALOG_PROBE_TIMEOUT_MS || 12_000));
const attempts = Math.max(1, Math.min(3, Number(process.env.CATALOG_PROBE_ATTEMPTS || 2)));
const concurrency = Math.max(1, Math.min(12, Number(process.env.CATALOG_PROBE_CONCURRENCY || 4)));
const outputFile = process.env.CATALOG_PROBE_OUTPUT || `catalog-probe-${market}-${shardIndex}.json`;
const allowRequiredSubset = /^(?:1|true|yes)$/i.test(String(process.env.CATALOG_PROBE_ALLOW_REQUIRED_SUBSET || ""));

// Only optional accelerators live here. The mandatory sites are sourced exclusively
// from required-catalog-sources.ts so they cannot drift between workflows and code.
const additionalPriorityPlan = {
  korea: [],
  china: ["guazi_china_ru", "guazi_china_export", "che168_dealer_exact", "sohu_auto_china_open", "che168_china_exact"],
  japan: ["japantransit_japan_stat_open", "auctions22_japan_past_open"],
  uae: ["dubicars_clean", "beforward_uae"],
  europe: ["otomoto_europe_exact", "otomoto_pl_open", "autouncle_europe"],
  georgia: ["auto_georgia_open", "ss_georgia_open", "myauto_georgia_exact"],
  kyrgyzstan: [],
};

if (!Object.prototype.hasOwnProperty.call(additionalPriorityPlan, market)) throw new Error(`unsupported_probe_market_${market || "missing"}`);

function withTimeout(promise, sourceId) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${sourceId}_probe_timeout_${timeoutMs}`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isUsableOffer(offer, sourceId) {
  return Boolean(
    offer
    && offer.id
    && offer.sourceId === sourceId
    && offer.market === market
    && Number(offer.sourcePrice || 0) > 0
    && offer.sourceCurrency
    && offer.operational?.sourceUrl
  );
}

async function runWithConcurrency(items, limit, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function probe(sourceId, adapters) {
  const source = adapters.get(sourceId);
  const startedAt = Date.now();
  if (!source) return { sourceId, active: false, reason: "source_not_found", durationMs: 0, attempts: 0, fetched: 0, usable: 0 };

  let lastError = "";
  let totalFetched = 0;
  let totalUsable = 0;
  let nextCursor = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await withTimeout(source.fetchPage(attempt === 1 ? null : nextCursor), sourceId);
      const rows = Array.isArray(result?.items) ? result.items : [];
      totalFetched += rows.length;
      for (const row of rows.slice(0, 100)) {
        try {
          if (isUsableOffer(source.normalizeOffer(row), sourceId)) totalUsable++;
        } catch {
          // One damaged card must not disable an entire source.
        }
      }
      nextCursor = result?.nextCursor || null;
      if (totalUsable > 0) {
        return {
          sourceId,
          active: true,
          reason: "live",
          durationMs: Date.now() - startedAt,
          attempts: attempt,
          fetched: totalFetched,
          usable: totalUsable,
          nextCursor,
          health: result?.health || null,
        };
      }
      if (!nextCursor) break;
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }

  return {
    sourceId,
    active: false,
    reason: lastError ? "probe_failed" : totalFetched ? "no_usable_offers" : "empty_page",
    durationMs: Date.now() - startedAt,
    attempts,
    fetched: totalFetched,
    usable: totalUsable,
    nextCursor,
    error: lastError || undefined,
  };
}

const adapters = new Map(catalogImportSources.map((source) => [source.sourceId, source]));
const registered = catalogImportSources
  .filter((source) => source.market === market || source.market === "multi")
  .map((source) => source.sourceId);
const requiredSourceIds = requiredCatalogSourceIds(market);
const configured = String(process.env.CATALOG_PROBE_SOURCE_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
const plannedAll = configured.length && allowRequiredSubset
  ? [...new Set(configured)]
  : [...new Set([...requiredSourceIds, ...configured, ...additionalPriorityPlan[market], ...registered])];
const priorityOrder = [...requiredSourceIds, ...additionalPriorityPlan[market]];
const priorityRank = new Map(priorityOrder.map((sourceId, index) => [sourceId, index]));
const planned = plannedAll
  .sort((left, right) => (priorityRank.get(left) ?? 10_000) - (priorityRank.get(right) ?? 10_000) || left.localeCompare(right));
const sourceIds = planned.filter((sourceId) => catalogSourceAssignedToShard(sourceId, shardIndex, shardCount));
const requiredSourceIdsForShard = requiredSourceIds.filter((sourceId) => catalogSourceAssignedToShard(sourceId, shardIndex, shardCount));
const results = await runWithConcurrency(sourceIds, concurrency, (sourceId) => probe(sourceId, adapters));
const activeSourceIds = results.filter((row) => row.active).map((row) => row.sourceId);
const inactiveSourceIds = results.filter((row) => !row.active).map((row) => row.sourceId);
const missingRequiredAdapters = requiredSourceIds.filter((sourceId) => !adapters.has(sourceId));
const requiredResults = results.filter((row) => requiredSourceIds.includes(row.sourceId));
const requiredActiveSourceIds = requiredResults.filter((row) => row.active).map((row) => row.sourceId);
const requiredInactiveSourceIds = requiredResults.filter((row) => !row.active).map((row) => row.sourceId);

// Probe is only an accelerator for optional sources. A short probe may time out,
// see an empty first page, or hit a transient block; it must never remove one of
// AvtoCena's canonical required sites from the real collector. Every mandatory
// source assigned to this shard is therefore handed to the collector regardless
// of probe result, while optional sources still need a successful probe.
const sourceIdsForRebuildList = [...new Set([...requiredSourceIdsForShard, ...activeSourceIds])]
  .filter((sourceId) => adapters.has(sourceId));
const sourceIdsForRebuild = sourceIdsForRebuildList.join(",") || "__no_active_sources__";
const payload = {
  version: 31,
  market,
  shardIndex,
  shardCount,
  checkedAt: new Date().toISOString(),
  timeoutMs,
  attempts,
  concurrency,
  allowRequiredSubset,
  registeredSourceCount: registered.length,
  requiredSourceIds,
  requiredSourceIdsForShard,
  missingRequiredAdapters,
  requiredActiveSourceIds,
  requiredInactiveSourceIds,
  requiredComplete: missingRequiredAdapters.length === 0 && requiredInactiveSourceIds.length === 0,
  plannedSourceIds: sourceIds,
  activeSourceIds,
  inactiveSourceIds,
  sourceIdsForRebuild,
  sourceIdsForRebuildList,
  results,
};

await fs.writeFile(outputFile, JSON.stringify(payload, null, 2));
if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `source_ids=${sourceIdsForRebuild}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `active_count=${activeSourceIds.length}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `planned_count=${sourceIds.length}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `required_complete=${payload.requiredComplete ? "1" : "0"}\n`);
}
if (process.env.GITHUB_ENV) {
  await fs.appendFile(process.env.GITHUB_ENV, `CATALOG_REBUILD_SOURCE_IDS=${sourceIdsForRebuild}\n`);
  await fs.appendFile(process.env.GITHUB_ENV, "CATALOG_V2_SOURCE_SLOTS_ONLY=0\n");
  await fs.appendFile(process.env.GITHUB_ENV, "CATALOG_REBUILD_IGNORE_PROBE=0\n");
  await fs.appendFile(process.env.GITHUB_ENV, "CATALOG_REBUILD_MAX_EMPTY_PAGES=25\n");
  await fs.appendFile(process.env.GITHUB_ENV, "CATALOG_REBUILD_MAX_SOURCE_ERRORS=3\n");
}
console.log(JSON.stringify(payload, null, 2));
