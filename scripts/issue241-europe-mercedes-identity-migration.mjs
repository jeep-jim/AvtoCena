import crypto from "node:crypto";
import fs from "node:fs/promises";

const { mutateDataJson } = await import("../apps/web/lib/data.ts");
const { persistCatalogOffers, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { canonicalSourceModelIdentity } = await import("../apps/web/lib/catalog/open-source-normalizer.ts");
const { isCatalogYearAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");
const { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");

const EXPECTED_COUNTS = {
  korea: 14368,
  china: 7277,
  japan: 2491,
  uae: 1042,
  europe: 3604,
  georgia: 2282,
  kyrgyzstan: 2188,
};
const EXPECTED_TARGET_IDS = new Set([
  "6906d7d816052a5b2610666f","7b737a21efadae84bc00104e","8b29e7fa08328ea7a4d16ed1","8a1b9bbd4ce168a51136acd4","22548d939e36f93b2d23053e","c835149813ac708e08b77c14","f228176becb418e474e18b64","e04352f15be8d6355936a213","40c1138f805b48b80f36e801","3061cad0b39c3bae276f8808","39d626b9ee8a070564d1952c","9fdd0a08b1efc2b8a83e4ef6","beb7379dbe7bcf373627ed45","32c64c33b90badffffe9de75","a1fdbf847f3c2b26d7e864b3","88e2dd1d739bbebce517db83","0c4dbe2ffba19fd4c1bb1577","92c84da829bb66e7e82d6e98","0638f8764fc2d2e8b88952c6","794f491d05c214dc565e3e78","8408cab3872e99690c2f371a","832ae9f292172221aa6d6b70","ca61c88592911c1f4099b5a6",
]);
const EXPECTED_DISTRIBUTION = { "A-Class": 6, "B-Class": 6, "C-Class": 1, "E-Class": 4, Sprinter: 3, Vito: 3 };
const GEORGIA_CANONICAL_SOURCE_IDS = new Set(["myauto_georgia_list", "autopapa_georgia_open"]);
const REPORT_PATH = String(process.env.ISSUE241_EUROPE_MERCEDES_REPORT || "issue241-europe-mercedes-identity-migration.json");
const DRY_RUN = String(process.env.ISSUE241_EUROPE_MERCEDES_DRY_RUN || "").toLowerCase() === "true";
const LOCK_PATH = "catalog/import-lock.json";
const operationId = `issue241_europe_mercedes_identity_${crypto.randomUUID()}`;
const waitMs = Math.max(0, Number(process.env.CATALOG_PUBLISH_LOCK_WAIT_MS || 7_200_000));
const pollMs = Math.max(1_000, Number(process.env.CATALOG_PUBLISH_LOCK_POLL_MS || 15_000));
const ttlMs = Math.max(30 * 60_000, Number(process.env.CATALOG_PUBLISH_LOCK_TTL_MS || 90 * 60_000));
let lockHeld = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sortedObject = (value) => {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedObject(value[key])]));
};
const stableHash = (value) => crypto.createHash("sha256").update(JSON.stringify(sortedObject(value))).digest("hex");
const rowsHash = (rows) => stableHash([...rows].sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || ""))));

async function acquireLock() {
  if (DRY_RUN) return;
  const deadline = Date.now() + waitMs;
  let last = "catalog_import_locked";
  while (true) {
    try {
      await mutateDataJson(LOCK_PATH, { lockedUntil: "" }, (current) => {
        const lockedUntil = Date.parse(String(current?.lockedUntil || ""));
        if (Number.isFinite(lockedUntil) && lockedUntil > Date.now() && current?.operationId !== operationId) {
          throw new Error(`catalog_import_locked_until_${new Date(lockedUntil).toISOString()}`);
        }
        return {
          operationId,
          operationType: "issue241_europe_mercedes_identity",
          lockedUntil: new Date(Date.now() + ttlMs).toISOString(),
          startedAt: new Date().toISOString(),
        };
      });
      lockHeld = true;
      return;
    } catch (error) {
      last = String(error?.message || error);
      if (!/catalog_(?:publish|import|certified_power)_locked/i.test(last) || Date.now() + pollMs > deadline) {
        throw new Error(`issue241_europe_mercedes_lock_wait_failed:${last}`);
      }
      console.log(`[issue241-europe-mercedes] waiting for catalog lock: ${last}`);
      await sleep(pollMs);
    }
  }
}

async function releaseLock() {
  if (!lockHeld) return;
  await mutateDataJson(LOCK_PATH, { lockedUntil: "" }, (current) => current?.operationId === operationId
    ? { operationId, operationType: "issue241_europe_mercedes_identity", lockedUntil: "", finishedAt: new Date().toISOString() }
    : current);
  lockHeld = false;
}

function maxQuota(rows, market) {
  const counts = new Map();
  for (const row of rows) {
    const key = catalogModelYearQuotaKey(row, market);
    if (!key) throw new Error(`missing_quota_key:${market}:${row?.id || "<missing>"}`);
    counts.set(key, Number(counts.get(key) || 0) + 1);
  }
  const over = [...counts.entries()].filter(([, count]) => count > CATALOG_MAX_OFFERS_PER_MODEL_YEAR).sort((a, b) => b[1] - a[1]);
  return { max: Math.max(0, ...counts.values()), over };
}

function assertGeorgiaCanonical(rows) {
  for (const row of rows) {
    const sourceId = String(row?.sourceId || "").trim();
    let host = "";
    const sourceUrl = String(row?.operational?.sourceUrl || row?.sourceUrl || "");
    try { host = new URL(sourceUrl).hostname.toLowerCase(); } catch {}
    const canonicalId = GEORGIA_CANONICAL_SOURCE_IDS.has(sourceId);
    const canonicalHost = /(^|\.)myauto\.ge$|(^|\.)autopapa\.ge$/.test(host);
    if (!canonicalId && !canonicalHost) {
      throw new Error(`georgia_noncanonical_source:${row?.id || "<missing>"}:${sourceId || "<missing-source-id>"}:${host || "<missing-host>"}`);
    }
  }
}

const beforeRows = {};
const beforeCounts = {};
const beforeHashes = {};
for (const market of PUBLIC_CATALOG_MARKETS) {
  const rows = await readMarketOffers(market);
  beforeRows[market] = rows;
  beforeCounts[market] = rows.length;
  beforeHashes[market] = rowsHash(rows);
  if (rows.length !== Number(EXPECTED_COUNTS[market])) throw new Error(`preflight_count_drift:${market}:${rows.length}:${EXPECTED_COUNTS[market]}`);
  for (const row of rows) {
    if (!isCatalogYearAllowed(row?.year, market)) throw new Error(`preflight_year:${market}:${row?.id || "<missing>"}:${row?.year}`);
  }
  if (market === "georgia") assertGeorgiaCanonical(rows);
}

const europeBefore = beforeRows.europe;
const targets = europeBefore.filter((row) => String(row?.make || "").toLowerCase() === "mercedes-benz"
  && String(row?.model || "").toLowerCase() === "benz"
  && Number(row?.year) === 2020);
const targetIds = new Set(targets.map((row) => String(row.id)));
if (targetIds.size !== EXPECTED_TARGET_IDS.size || [...EXPECTED_TARGET_IDS].some((id) => !targetIds.has(id))) {
  throw new Error(`preflight_target_drift:${targetIds.size}:${JSON.stringify([...targetIds].sort())}`);
}

const changes = [];
const europeProjected = europeBefore.map((row) => {
  if (!EXPECTED_TARGET_IDS.has(String(row.id))) return row;
  const model = canonicalSourceModelIdentity(String(row?.sourceTitle || row?.trim || ""), String(row?.make || ""), String(row?.model || ""));
  if (!model || model.toLowerCase() === "benz") throw new Error(`preflight_unresolved_target:${row.id}:${row?.sourceTitle || row?.trim || ""}`);
  changes.push({ id: row.id, sourceId: row.sourceId, sourceOfferId: row.sourceOfferId, from: row.model, to: model, sourceTitle: row.sourceTitle || "" });
  return { ...row, model };
});
if (changes.length !== EXPECTED_TARGET_IDS.size) throw new Error(`preflight_change_count:${changes.length}`);

const distribution = changes.reduce((out, row) => { out[row.to] = Number(out[row.to] || 0) + 1; return out; }, {});
const ordered = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
if (JSON.stringify(ordered(distribution)) !== JSON.stringify(ordered(EXPECTED_DISTRIBUTION))) {
  throw new Error(`preflight_distribution:${JSON.stringify(distribution)}`);
}

const projectedRows = { ...beforeRows, europe: europeProjected };
const projectedQuota = {};
for (const market of PUBLIC_CATALOG_MARKETS) {
  const quota = maxQuota(projectedRows[market], market);
  projectedQuota[market] = quota.max;
  if (quota.over.length) throw new Error(`preflight_quota:${market}:${JSON.stringify(quota.over.slice(0, 10))}`);
}
if (projectedRows.europe.length !== beforeRows.europe.length) throw new Error("preflight_europe_count_changed");
for (const market of PUBLIC_CATALOG_MARKETS) {
  if (market !== "europe" && rowsHash(projectedRows[market]) !== beforeHashes[market]) throw new Error(`preflight_preservation_hash:${market}`);
}

const preflightReport = {
  version: 1,
  mode: DRY_RUN ? "dry_run" : "write",
  operation: "issue241_europe_mercedes_identity_migration",
  beforeCounts,
  projectedCounts: Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, projectedRows[market].length])),
  projectedQuota,
  changes,
  distribution,
};

if (DRY_RUN) {
  await fs.writeFile(REPORT_PATH, JSON.stringify({ ...preflightReport, persisted: false }, null, 2));
  console.log(JSON.stringify({ ...preflightReport, persisted: false }, null, 2));
  process.exit(0);
}

await acquireLock();
try {
  const lockedRows = {};
  for (const market of PUBLIC_CATALOG_MARKETS) {
    const rows = await readMarketOffers(market);
    lockedRows[market] = rows;
    if (rowsHash(rows) !== beforeHashes[market]) throw new Error(`locked_state_drift:${market}`);
  }

  const combined = [];
  for (const market of PUBLIC_CATALOG_MARKETS) combined.push(...(market === "europe" ? europeProjected : lockedRows[market]));
  process.env.CATALOG_GROW_ONLY_MARKETS = "";
  const manifest = await persistCatalogOffers(combined);

  const afterCounts = {};
  const afterQuota = {};
  const failures = [];
  for (const market of PUBLIC_CATALOG_MARKETS) {
    const rows = await readMarketOffers(market);
    afterCounts[market] = rows.length;
    const quota = maxQuota(rows, market);
    afterQuota[market] = quota.max;
    if (rows.length !== beforeCounts[market]) failures.push(`count:${market}:${beforeCounts[market]}:${rows.length}`);
    if (quota.over.length) failures.push(`quota:${market}:${JSON.stringify(quota.over.slice(0, 5))}`);
    const badYear = rows.find((row) => !isCatalogYearAllowed(row?.year, market));
    if (badYear) failures.push(`year:${market}:${badYear.id}:${badYear.year}`);
    if (rows.length !== Number(manifest?.markets?.[market]?.count || 0)) failures.push(`manifest:${market}:${rows.length}:${Number(manifest?.markets?.[market]?.count || 0)}`);
    if (market === "georgia") {
      try { assertGeorgiaCanonical(rows); } catch (error) { failures.push(String(error?.message || error)); }
    }
    if (market !== "europe" && rowsHash(rows) !== beforeHashes[market]) failures.push(`preservation_hash:${market}`);
  }

  const europeAfter = await readMarketOffers("europe");
  const remainingBenz2020 = europeAfter.filter((row) => String(row?.make || "").toLowerCase() === "mercedes-benz"
    && String(row?.model || "").toLowerCase() === "benz"
    && Number(row?.year) === 2020);
  if (remainingBenz2020.length) failures.push(`remaining_benz_2020:${remainingBenz2020.length}`);
  for (const change of changes) {
    const row = europeAfter.find((item) => String(item.id) === String(change.id));
    if (!row || row.model !== change.to) failures.push(`target_model:${change.id}:${row?.model || "<missing>"}:${change.to}`);
  }

  const report = {
    ...preflightReport,
    persisted: true,
    generationId: manifest?.generationId || "",
    afterCounts,
    afterQuota,
    remainingBenz2020: remainingBenz2020.length,
    failures,
  };
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) throw new Error(`postpersist_failures:${failures.join("|")}`);
} finally {
  await releaseLock();
}
