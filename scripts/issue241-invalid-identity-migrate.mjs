import crypto from "node:crypto";
import fs from "node:fs/promises";

const { mutateDataJson, readDataJson } = await import("../apps/web/lib/data.ts");
const {
  offerPath,
  persistCatalogOffers,
  readAllOffersForMaintenance,
  readMarketOffers,
} = await import("../apps/web/lib/catalog/storage.ts");
const {
  hasCredibleCatalogIdentity,
  isCatalogMarketSourceAllowed,
  isCatalogYearAllowed,
} = await import("../apps/web/lib/catalog/offer-quality.ts");
const { presentCatalogOffer } = await import("../apps/web/lib/catalog/presentation.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");
const {
  CATALOG_MAX_OFFERS_PER_MODEL_YEAR,
  catalogModelYearQuotaKey,
} = await import("../apps/web/lib/catalog/inventory-quota.ts");

const APPLY = /^(?:1|true|yes)$/i.test(String(process.env.ISSUE241_IDENTITY_APPLY || ""));
const OUTPUT = process.env.ISSUE241_IDENTITY_OUTPUT || "issue241-invalid-identity-migration-report.json";
const publishLockPath = "catalog/import-lock.json";
const publishOperationId = `issue241_identity_migration_${crypto.randomUUID()}`;
const publishLockWaitMs = Math.max(0, Number(process.env.CATALOG_PUBLISH_LOCK_WAIT_MS || 7_200_000));
const publishLockPollMs = Math.max(1_000, Number(process.env.CATALOG_PUBLISH_LOCK_POLL_MS || 15_000));
const publishLockTtlMs = Math.max(30 * 60_000, Number(process.env.CATALOG_PUBLISH_LOCK_TTL_MS || 90 * 60_000));
let publishLockHeld = false;

// Every replacement below is bound to immutable source evidence captured in the
// read-only issue241 audit. If any source id/title/trim changed, this script fails
// instead of guessing a model.
const CHINA = new Map([
  ["eaf771e7d22d131a2ad04699", { sourceOfferId: "59213953", model: "Vito", title: "Mercedes-Benz Vito 2024 2.0T Business 8-Seater" }],
  ["624cc41eabaab98fcae4f7c3", { sourceOfferId: "59081175", model: "Vito", title: "Mercedes-Benz Vito 2021 2.0T Elite 7-Seater" }],
  ["ae7d47fe75d4d3a3d4536bf6", { sourceOfferId: "58527163", model: "Vito", title: "Mercedes-Benz Vito 2020 2.0T Business Edition (7-seater)" }],
]);
const EUROPE_DROP = new Map([
  ["0fe20194a02404dac83c3ab5", { sourceOfferId: "460544569", make: "Andere", model: "Andere" }],
  ["fb940ab4c952c58054f960c9", { sourceOfferId: "433923524", make: "Aixam", model: "Andere" }],
]);
const GEORGIA = new Map([
  ["969aa654b10912c253965e05", "GT43"], ["b2685471dafae4fd3d143520", "E 200"], ["5895aab6044a4a60adfda5bb", "E 200"],
  ["aa12ccf3585b176c1ea97e30", "E 200"], ["1e7e07149e69512c1ea97e30", "S 580"],
]);

// Keep the canonical 25-row AutoPapa mapping explicit. It intentionally excludes
// every banned Georgia source.
GEORGIA.clear();
for (const [id, model] of [
  ["969aa654b10912c253965e05", "GT43"], ["b2685471dafae4fd3d143520", "E 200"], ["5895aab6044a4a60adfda5bb", "E 200"],
  ["aa12ccf3585b176c1ea97e30", "E 200"], ["1e7e07149e69512b4b61b38c", "S 580"], ["7a82aa9e94991f9773762bfa", "S 580"],
  ["5164f5bf52a7806042ff720f", "E 50"], ["578e91bc5ef6dbe985354d33", "S 580"], ["a3c8158cf6bab70bff73c774", "E 200"],
  ["446abfdd342a5bac408234b2", "Vito"], ["35c24308a9acc64246aa1005", "S 580"], ["5d5e5952f01170a8db1fe08a", "V300"],
  ["b157afdcff0cd5d75dd7899d", "GT63"], ["d9333b5c6b809a34c4a55713", "GT43"], ["c35e2eb821c7608b6ef8913f", "GT43"],
  ["5df518cb66a9faa4d0d1d912", "V300"], ["18298c3abb459a650a138628", "GT63"], ["495f7addeaf3c52a03170af5", "V300"],
  ["3ecfa91d522ba0f157d67482", "S 580"], ["31a86ee37a5fd01aa0de194d", "S 580"], ["cd9ba00ead2a36f56e3c15dc", "G 550"],
  ["79b4295ffa9d4d7dd9a8a0f9", "S 580"], ["18a54d89da725ca44f300943", "S 580"], ["932ca3ec4167e90bd84fc398", "S 580"],
  ["b2f18638f3ccdd09c60d6987", "G 550"],
]) GEORGIA.set(id, model);

const KYRGYZSTAN = new Map([
  ["5fcd42771a31967360574bb2", "E-Класс"], ["4a2bf05fc6f26f87b4ddfebf", "E-Класс"],
  ["4e2f70c067916e0c8255cc2f", "S-Класс"], ["fa137d60e1e2527cf931fb2a", "S-Класс"],
  ["47c3dd615f3aaf72f3a0b205", "S-Класс"], ["f33c80f54102191c80a4d6b8", "S-Класс"],
  ["50bb6739aab47be18a4304f6", "S-Класс"], ["bb5adeddd6220e587dcbeb55", "S-Класс"],
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function hashRows(rows) {
  const canonical = [...rows]
    .sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")))
    .map(stable);
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
function normalizedIdentity(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
const placeholder = /^(?:unknown|undefined|null|none|n\/?a|other(?:s)?|andere|brand|make|model|марка(?:\s+уточняется)?|модель(?:\s+уточняется)?|уточняется|не\s+указано|неизвестно|기타|미상|其他|未知|その他)$/iu;
const internalSeries = /^(?:series|серия)\s*[-:#]?\s*\d+(?:\s|$)/iu;
function renderedProblems(offer) {
  const presented = presentCatalogOffer(offer);
  const makeLabel = String(presented?.makeLabel || "").trim();
  const modelLabel = String(presented?.modelLabel || "").trim();
  const title = String(presented?.title || "").trim();
  const sourceSame = normalizedIdentity(offer?.make) && normalizedIdentity(offer?.make) === normalizedIdentity(offer?.model);
  const problems = [];
  if (!makeLabel || placeholder.test(makeLabel)) problems.push("display_make_missing");
  if (!modelLabel || placeholder.test(modelLabel)) problems.push("display_model_missing");
  if (internalSeries.test(modelLabel)) problems.push("display_internal_series");
  if (!sourceSame && makeLabel && modelLabel && normalizedIdentity(makeLabel) === normalizedIdentity(modelLabel)) problems.push("display_model_equals_make");
  if (!sourceSame && makeLabel && title && normalizedIdentity(title) === normalizedIdentity(makeLabel)) problems.push("display_title_make_only");
  return problems;
}
function assertExact(condition, message) {
  if (!condition) throw new Error(message);
}
function migrate(offer) {
  const id = String(offer?.id || "");
  if (CHINA.has(id)) {
    const expected = CHINA.get(id);
    assertExact(offer.market === "china" && offer.sourceId === "autohome_used_china_open", `china_source_changed:${id}`);
    assertExact(String(offer.sourceOfferId) === expected.sourceOfferId, `china_source_offer_changed:${id}`);
    assertExact(offer.make === "Mercedes-Benz" && offer.model === "Benz" && offer.sourceTitle === expected.title, `china_evidence_changed:${id}`);
    return { ...offer, model: expected.model };
  }
  if (EUROPE_DROP.has(id)) {
    const expected = EUROPE_DROP.get(id);
    assertExact(offer.market === "europe" && offer.sourceId === "mobile_de_open", `europe_source_changed:${id}`);
    assertExact(String(offer.sourceOfferId) === expected.sourceOfferId && offer.make === expected.make && offer.model === expected.model, `europe_evidence_changed:${id}`);
    return null;
  }
  if (GEORGIA.has(id)) {
    const model = GEORGIA.get(id);
    assertExact(offer.market === "georgia" && offer.sourceId === "autopapa_georgia_open", `georgia_source_changed:${id}`);
    assertExact(offer.make === "Mercedes-Benz" && offer.model === "Benz", `georgia_identity_changed:${id}`);
    assertExact(String(offer.trim || "") === `Mercedes-Benz ${model}`, `georgia_evidence_changed:${id}:${String(offer.trim || "")}`);
    return { ...offer, model };
  }
  if (KYRGYZSTAN.has(id)) {
    const model = KYRGYZSTAN.get(id);
    assertExact(offer.market === "kyrgyzstan" && offer.sourceId === "mashina_kyrgyzstan_exact", `kyrgyzstan_source_changed:${id}`);
    assertExact(offer.make === "Mercedes-Benz" && offer.model === "Benz", `kyrgyzstan_identity_changed:${id}`);
    assertExact(String(offer.trim || "").startsWith(`Mercedes-Benz ${model} `), `kyrgyzstan_evidence_changed:${id}:${String(offer.trim || "")}`);
    return { ...offer, model };
  }
  return offer;
}

function marketAudit(rows, market) {
  const modelYearCounts = new Map();
  for (const offer of rows) {
    const key = catalogModelYearQuotaKey(offer, market);
    if (key) modelYearCounts.set(key, Number(modelYearCounts.get(key) || 0) + 1);
  }
  const nonVehicle = /\b(?:motorcycle|motorbike|scooter|forklift|excavator|bulldozer|tractor|crane|generator|boat|ship|machinery|spare\s+parts?|engine\s+only|truck|dump|tipper|lorry)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;
  return {
    count: rows.length,
    hash: hashRows(rows),
    invalidIdentity: rows.filter((offer) => !hasCredibleCatalogIdentity(offer)).length,
    renderedIdentity: rows.filter((offer) => renderedProblems(offer).length).length,
    belowYear: rows.filter((offer) => !isCatalogYearAllowed(offer?.year, market)).length,
    invalidSource: rows.filter((offer) => !isCatalogMarketSourceAllowed(offer)).length,
    nonVehicle: rows.filter((offer) => nonVehicle.test(`${offer?.make || ""} ${offer?.model || ""} ${offer?.trim || ""} ${offer?.bodyType || ""}`)).length,
    badPrice: rows.filter((offer) => !(Number(offer?.sourcePrice || 0) > 0) || !String(offer?.sourceCurrency || "").trim()).length,
    belowFive: rows.filter((offer) => !Array.isArray(offer?.images) || offer.images.length < 5).length,
    maxModelYear: modelYearCounts.size ? Math.max(...modelYearCounts.values()) : 0,
  };
}
function assertAuditClean(after, before, market) {
  assertExact(after.invalidIdentity === 0, `${market}:invalid_identity:${after.invalidIdentity}`);
  assertExact(after.renderedIdentity === 0, `${market}:rendered_identity:${after.renderedIdentity}`);
  assertExact(after.belowYear === 0, `${market}:year:${after.belowYear}`);
  assertExact(after.invalidSource === 0, `${market}:source:${after.invalidSource}`);
  assertExact(after.nonVehicle === 0, `${market}:non_vehicle:${after.nonVehicle}`);
  assertExact(after.badPrice === 0, `${market}:source_price:${after.badPrice}`);
  assertExact(after.maxModelYear <= CATALOG_MAX_OFFERS_PER_MODEL_YEAR, `${market}:model_year:${after.maxModelYear}`);
  assertExact(after.belowFive === before.belowFive, `${market}:photo_count_changed:${before.belowFive}:${after.belowFive}`);
  if (market === "korea" || market === "japan") assertExact(after.belowFive === 0, `${market}:below_five:${after.belowFive}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function acquirePublishLock() {
  const deadline = Date.now() + publishLockWaitMs;
  let lastLock = "catalog_publish_locked";
  while (true) {
    try {
      await mutateDataJson(publishLockPath, { lockedUntil: "" }, (current) => {
        const lockedUntil = Date.parse(String(current?.lockedUntil || ""));
        if (Number.isFinite(lockedUntil) && lockedUntil > Date.now() && current?.operationId !== publishOperationId) {
          throw new Error(`catalog_publish_locked_until_${new Date(lockedUntil).toISOString()}`);
        }
        return {
          operationId: publishOperationId,
          operationType: "issue241_invalid_identity_migration",
          lockedUntil: new Date(Date.now() + publishLockTtlMs).toISOString(),
          startedAt: new Date().toISOString(),
        };
      });
      publishLockHeld = true;
      return;
    } catch (error) {
      lastLock = String(error?.message || error);
      if (!/catalog_(?:publish|import|certified_power)_locked/i.test(lastLock) || Date.now() + publishLockPollMs > deadline) {
        throw new Error(`catalog_publish_lock_wait_failed:${lastLock}`);
      }
      console.log(`[publish-lock] issue241 identity migration waiting: ${lastLock}`);
      await sleep(publishLockPollMs);
    }
  }
}
async function releasePublishLock() {
  if (!publishLockHeld) return;
  await mutateDataJson(publishLockPath, { lockedUntil: "" }, (current) => current?.operationId === publishOperationId
    ? { operationId: publishOperationId, operationType: "issue241_invalid_identity_migration", lockedUntil: "", finishedAt: new Date().toISOString() }
    : current);
  publishLockHeld = false;
}

async function readGenerationMarket(manifest, market) {
  const chunks = manifest?.markets?.[market]?.chunks || [];
  const parts = await Promise.all(chunks.map((chunk) => readDataJson(offerPath(manifest.generationId, market, chunk), [])));
  return parts.flat();
}
async function readInternalGeneration() {
  const manifest = await readDataJson("catalog/internal/manifest.json", { generationId: "", sources: {} });
  const chunks = Object.values(manifest.sources || {}).flatMap((source) => source?.chunks || []);
  const parts = await Promise.all(chunks.map((chunk) => readDataJson(chunk, [])));
  return { manifest, rows: parts.flat() };
}

async function planCurrentState() {
  const publicBefore = {};
  for (const market of PUBLIC_CATALOG_MARKETS) publicBefore[market] = await readMarketOffers(market);
  const internalBefore = await readAllOffersForMaintenance();
  const expectedIds = new Set([...CHINA.keys(), ...EUROPE_DROP.keys(), ...GEORGIA.keys(), ...KYRGYZSTAN.keys()]);
  assertExact(CHINA.size === 3 && EUROPE_DROP.size === 2 && GEORGIA.size === 25 && KYRGYZSTAN.size === 8, "migration_mapping_size_changed");
  assertExact(expectedIds.size === 38, `migration_mapping_duplicate_id:${expectedIds.size}`);

  const publicInvalidIds = new Set(Object.values(publicBefore).flat().filter((offer) => !hasCredibleCatalogIdentity(offer)).map((offer) => String(offer.id || "")));
  assertExact(publicInvalidIds.size === 38, `invalid_identity_total_changed:${publicInvalidIds.size}`);
  assertExact([...publicInvalidIds].every((id) => expectedIds.has(id)) && [...expectedIds].every((id) => publicInvalidIds.has(id)), "invalid_identity_set_changed");
  const internalIds = new Set(internalBefore.map((offer) => String(offer?.id || "")));
  for (const id of expectedIds) assertExact(internalIds.has(id), `internal_identity_row_missing:${id}`);

  const publicAfter = {};
  for (const market of PUBLIC_CATALOG_MARKETS) publicAfter[market] = publicBefore[market].map(migrate).filter(Boolean);
  const internalAfter = internalBefore.map(migrate).filter(Boolean);
  const beforeAudit = {};
  const afterAudit = {};
  for (const market of PUBLIC_CATALOG_MARKETS) {
    beforeAudit[market] = marketAudit(publicBefore[market], market);
    afterAudit[market] = marketAudit(publicAfter[market], market);
    assertAuditClean(afterAudit[market], beforeAudit[market], market);
  }

  for (const market of ["korea", "japan", "uae"]) {
    assertExact(beforeAudit[market].hash === afterAudit[market].hash, `${market}:unexpected_hash_change`);
  }
  for (const market of ["china", "georgia", "kyrgyzstan"]) {
    assertExact(beforeAudit[market].count === afterAudit[market].count, `${market}:unexpected_count_change`);
  }
  assertExact(afterAudit.europe.count === beforeAudit.europe.count - 2, `europe:unexpected_count_delta:${beforeAudit.europe.count}:${afterAudit.europe.count}`);
  assertExact(internalAfter.length === internalBefore.length - 2, `internal:unexpected_count_delta:${internalBefore.length}:${internalAfter.length}`);
  const internalAfterIds = new Set(internalAfter.map((offer) => String(offer?.id || "")));
  for (const id of EUROPE_DROP.keys()) assertExact(!internalAfterIds.has(id), `europe_drop_internal_retained:${id}`);

  return { publicBefore, publicAfter, internalBefore, internalAfter, beforeAudit, afterAudit };
}

let report = null;
try {
  if (APPLY) await acquirePublishLock();
  const plan = await planCurrentState();
  report = {
    version: 1,
    mode: APPLY ? "issue241_invalid_identity_migration_apply" : "issue241_invalid_identity_migration_plan",
    checkedAt: new Date().toISOString(),
    applied: false,
    generationId: null,
    expectedChanges: {
      chinaModelRepairs: CHINA.size,
      europeDrops: EUROPE_DROP.size,
      georgiaModelRepairs: GEORGIA.size,
      kyrgyzstanModelRepairs: KYRGYZSTAN.size,
    },
    internalBefore: plan.internalBefore.length,
    internalAfter: plan.internalAfter.length,
    before: plan.beforeAudit,
    after: plan.afterAudit,
  };

  if (APPLY) {
    // Preserve the exact planned public rows for all seven markets. PR #510 makes
    // these rows bypass normalization/enrichment, so this write can change only
    // the 36 source-proven model values and remove the 2 unprovable Europe rows.
    const manifest = await persistCatalogOffers(plan.internalAfter, {
      preservePublicOffersByMarket: plan.publicAfter,
      beforePersistValidate(publicOffers) {
        for (const market of PUBLIC_CATALOG_MARKETS) {
          const projected = publicOffers.filter((offer) => String(offer?.market || "") === market);
          assertExact(projected.length === plan.afterAudit[market].count, `prewrite:${market}:count:${projected.length}:${plan.afterAudit[market].count}`);
          assertExact(hashRows(projected) === plan.afterAudit[market].hash, `prewrite:${market}:hash_mismatch`);
        }
      },
    });

    const persistedPublic = {};
    for (const market of PUBLIC_CATALOG_MARKETS) persistedPublic[market] = await readGenerationMarket(manifest, market);
    for (const market of PUBLIC_CATALOG_MARKETS) {
      const persistedAudit = marketAudit(persistedPublic[market], market);
      assertExact(persistedAudit.count === plan.afterAudit[market].count, `postwrite:${market}:count:${persistedAudit.count}:${plan.afterAudit[market].count}`);
      assertExact(persistedAudit.hash === plan.afterAudit[market].hash, `postwrite:${market}:hash_mismatch`);
      assertAuditClean(persistedAudit, plan.beforeAudit[market], market);
    }
    const persistedInternal = await readInternalGeneration();
    assertExact(persistedInternal.rows.length === plan.internalAfter.length, `postwrite:internal_count:${persistedInternal.rows.length}:${plan.internalAfter.length}`);
    assertExact(hashRows(persistedInternal.rows) === hashRows(plan.internalAfter), "postwrite:internal_hash_mismatch");

    report.applied = true;
    report.generationId = manifest.generationId;
    report.persistedInternalGenerationId = persistedInternal.manifest.generationId;
    report.persisted = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, marketAudit(persistedPublic[market], market)]));
  }

  await fs.writeFile(OUTPUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (APPLY) await releasePublishLock();
}
