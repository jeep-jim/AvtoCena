from pathlib import Path

single = Path("scripts/catalog-live-recovery-publish.mjs")
s = single.read_text()
replacements = [
    (
        'const { persistCatalogOffers, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");',
        'const { persistCatalogOffers, readAllOffersForMaintenance, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");',
    ),
    (
        'const { credibleCatalogImages, isCatalogOfferBusinessLiquid, catalogMinYearForMarket, isCatalogYearAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");',
        'const { credibleCatalogImages, isCatalogOfferBusinessLiquid, catalogMinYearForMarket, isCatalogYearAllowed, isCatalogMarketSourceAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");',
    ),
    (
        "const maxOffersPerModelYear = CATALOG_MAX_OFFERS_PER_MODEL_YEAR;\nconst retentionMs =",
        "const maxOffersPerModelYear = CATALOG_MAX_OFFERS_PER_MODEL_YEAR;\nconst minImagesPerOffer = Math.max(1, Math.min(30, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5)));\nconst retentionMs =",
    ),
    (
        'function makeKey(offer) { return String(offer?.make || "").trim().toLowerCase().replace(/\\s+/g, " "); }',
        'function makeKey(offer) { return String(offer?.make || "").trim().toLowerCase().replace(/\\s+/g, " "); }\nfunction hashRows(rows) { return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex"); }',
    ),
    (
        'if (!offer.make || !offer.model || !offer.images.length) { reject("visible_core"); continue; }',
        'if (!offer.make || !offer.model) { reject("visible_core"); continue; }\n  if (offer.images.length < minImagesPerOffer) { reject("images"); continue; }',
    ),
    (
        'if (!isCatalogYearAllowed(year, market) || !offer.make || !offer.model || !offer.images.length) continue;',
        'if (!isCatalogYearAllowed(year, market) || !offer.make || !offer.model || offer.images.length < minImagesPerOffer) continue;',
    ),
]
for old, new in replacements:
    if old not in s:
        raise SystemExit(f"single publisher target not found: {old[:100]}")
    s = s.replace(old, new, 1)

old_preservation = '''if (!marketRows.length) {
  const report = { version: 2, mode: "live_market_exact_calculated_cumulative_publish", market, published: false, generationId: null, count: 0, retainedCount: 0, incomingCount: incoming.size, rejected, publicationError: `recovery_empty_market:${market}` };
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  throw new Error(`recovery_empty_market:${market}`);
}

const combined = [...marketRows];
const preservedByMarket = {};
for (const other of PUBLIC_CATALOG_MARKETS) {
  if (other === market) continue;
  let rows = [];
  try { rows = await readMarketOffers(other); } catch { rows = []; }
  const preserved = rows
    .filter((offer) => ["active", "stale"].includes(String(offer?.status || "")))
    .map(normalizeVisible)
    .filter((offer) => offer.id && offer.make && offer.model && isCatalogYearAllowed(offer.year, other) && offer.images.length > 0 && withinRetention(offer) && isCatalogOfferBusinessLiquid(offer))
    .slice(0, CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET || 100_000);
  preservedByMarket[other] = preserved.length;
  combined.push(...preserved);
}
const unique = new Map();
for (const offer of combined) if (offer?.id && !unique.has(offer.id)) unique.set(offer.id, offer);
'''
new_preservation = '''if (!marketRows.length) {
  const report = { version: 3, mode: "live_market_exact_calculated_cumulative_publish", market, published: false, generationId: null, count: 0, retainedCount: 0, incomingCount: incoming.size, rejected, publicationError: `recovery_empty_market:${market}` };
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  throw new Error(`recovery_empty_market:${market}`);
}
if (marketRows.some((offer) => offer.images.length < minImagesPerOffer)) {
  throw new Error(`recovery_target_image_gate_failed:${market}:${minImagesPerOffer}`);
}

// Recovery replaces only the requested market inside the complete internal state.
// Untouched markets are never reconstructed from filtered public projections.
const currentInternal = await readAllOffersForMaintenance();
if (!Array.isArray(currentInternal)) throw new Error("recovery_maintenance_state_invalid");
const preservedInternal = currentInternal.filter((offer) => String(offer?.market || "") !== market);
const invalidInternal = preservedInternal.filter((offer) => {
  const other = String(offer?.market || "");
  return !offer?.id || !PUBLIC_CATALOG_MARKETS.includes(other) || !isCatalogYearAllowed(offer?.year, other) || !isCatalogMarketSourceAllowed(offer);
});
if (invalidInternal.length) throw new Error(`recovery_preserved_internal_gate_failed:${invalidInternal.length}`);

const preservedByMarket = {};
const preservedInternalByMarket = {};
const preservedPublicHashByMarket = {};
for (const other of PUBLIC_CATALOG_MARKETS) {
  if (other === market) continue;
  const internalRows = preservedInternal.filter((offer) => String(offer?.market || "") === other);
  preservedInternalByMarket[other] = internalRows.length;
  let rows = [];
  try { rows = await readMarketOffers(other); } catch (error) { throw new Error(`recovery_preserved_public_read_failed:${other}:${String(error?.message || error)}`); }
  const invalidPublic = rows.filter((offer) => !offer?.id || !offer?.make || !offer?.model || !isCatalogYearAllowed(offer?.year, other) || !isCatalogMarketSourceAllowed(offer) || !Array.isArray(offer?.images) || offer.images.length === 0);
  if (invalidPublic.length) throw new Error(`recovery_preserved_public_gate_failed:${other}:${invalidPublic.length}`);
  if (rows.length > 0 && internalRows.length === 0) throw new Error(`recovery_preserved_internal_missing:${other}`);
  preservedByMarket[other] = rows.length;
  preservedPublicHashByMarket[other] = hashRows(rows);
}

const combined = [...preservedInternal, ...marketRows];
const unique = new Map();
for (const offer of combined) if (offer?.id && !unique.has(offer.id)) unique.set(offer.id, offer);
if (unique.size !== combined.length) throw new Error(`recovery_duplicate_id_in_full_state:${combined.length - unique.size}`);
'''
if old_preservation not in s:
    raise SystemExit("single publisher preservation block not found")
s = s.replace(old_preservation, new_preservation, 1)

old_post = '''const postPersistByMarket = {};
let postPersistError = "";
if (manifest) {
  try {
    for (const currentMarket of PUBLIC_CATALOG_MARKETS) {
      postPersistByMarket[currentMarket] = (await readMarketOffers(currentMarket)).length;
    }
  } catch (error) {
    postPersistError = String(error?.message || error);
  }
}
'''
new_post = '''const postPersistByMarket = {};
const postPersistPublicHashByMarket = {};
const preservationFailures = [];
let postPersistError = "";
if (manifest) {
  try {
    for (const currentMarket of PUBLIC_CATALOG_MARKETS) {
      const rows = await readMarketOffers(currentMarket);
      postPersistByMarket[currentMarket] = rows.length;
      if (currentMarket !== market) {
        const afterHash = hashRows(rows);
        postPersistPublicHashByMarket[currentMarket] = afterHash;
        if (rows.length !== Number(preservedByMarket[currentMarket] || 0)) preservationFailures.push(`${currentMarket}:count:${rows.length}:${preservedByMarket[currentMarket] || 0}`);
        if (afterHash !== preservedPublicHashByMarket[currentMarket]) preservationFailures.push(`${currentMarket}:hash:${afterHash}:${preservedPublicHashByMarket[currentMarket]}`);
      }
    }
  } catch (error) {
    postPersistError = String(error?.message || error);
  }
}
'''
if old_post not in s:
    raise SystemExit("single publisher post-persist block not found")
s = s.replace(old_post, new_post, 1)
s = s.replace(
    '  version: 2,\n  mode: "live_market_exact_calculated_cumulative_publish",',
    '  version: 3,\n  mode: "live_market_exact_calculated_cumulative_publish",',
    1,
)
s = s.replace(
    "  maxOffersPerModelYear,\n  distinctModels:",
    "  maxOffersPerModelYear,\n  minImagesPerOffer,\n  preservedInternalByMarket,\n  preservedPublicHashByMarket,\n  postPersistPublicHashByMarket,\n  preservationFailures,\n  distinctModels:",
    1,
)
s = s.replace(
    "if (!manifest || publicationError) process.exitCode = 1;",
    "if (!manifest || publicationError || postPersistError || preservationFailures.length) process.exitCode = 1;",
    1,
)
single.write_text(s)

batch = Path("scripts/catalog-live-recovery-publish-batch.mjs")
b = batch.read_text()
old_flag = 'const preserveUntouchedExact = /^(1|true|yes)$/i.test(String(process.env.RECOVERY_BATCH_PRESERVE_UNTOUCHED_EXACT || ""));'
if old_flag not in b:
    raise SystemExit("batch preservation flag target not found")
b = b.replace(old_flag, "const preserveUntouchedExact = true; // mandatory fail-closed full-state preservation", 1)
batch.write_text(b)

Path("tests/catalog-recovery-publisher-min-images.test.ts").write_text('''import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const batchSource = fs.readFileSync(new URL("../scripts/catalog-live-recovery-publish-batch.mjs", import.meta.url), "utf8");
const singleSource = fs.readFileSync(new URL("../scripts/catalog-live-recovery-publish.mjs", import.meta.url), "utf8");

test("batch recovery publisher enforces configured minimum images on target incoming and retained rows", () => {
  assert.match(batchSource, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER\\s*\\|\\|\\s*5/);
  assert.match(batchSource, /offer\\.images\\.length < minImagesPerOffer\\) \\{ reject\\("images"\\); continue; \\}/);
  assert.match(batchSource, /offer\\.images\\.length < minImagesPerOffer\\) continue;/);
  assert.match(batchSource, /recovery_batch_target_image_gate_failed/);
  assert.match(batchSource, /belowMinimum: rows\\.filter\\(\\(offer\\) => offer\\.images\\.length < minImagesPerOffer\\)\\.length/);
});

test("single recovery publisher enforces the same target five-photo floor", () => {
  assert.match(singleSource, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER\\s*\\|\\|\\s*5/);
  assert.match(singleSource, /offer\\.images\\.length < minImagesPerOffer\\) \\{ reject\\("images"\\); continue; \\}/);
  assert.match(singleSource, /offer\\.images\\.length < minImagesPerOffer\\) continue;/);
  assert.match(singleSource, /recovery_target_image_gate_failed/);
});

test("single and batch recovery publishers preserve untouched markets from complete maintenance state", () => {
  for (const source of [singleSource, batchSource]) assert.match(source, /readAllOffersForMaintenance/);
  assert.match(singleSource, /const currentInternal = await readAllOffersForMaintenance\\(\\);/);
  assert.match(singleSource, /const preservedInternal = currentInternal\\.filter/);
  assert.match(batchSource, /const preserveUntouchedExact = true/);
  assert.match(batchSource, /const maintenanceOffers = preserveUntouchedExact \\? await readAllOffersForMaintenance\\(\\) : \\[\\];/);
});

test("single recovery publisher hashes untouched public projections before and after persistence", () => {
  assert.match(singleSource, /preservedPublicHashByMarket/);
  assert.match(singleSource, /postPersistPublicHashByMarket/);
  assert.match(singleSource, /preservationFailures/);
  assert.match(singleSource, /recovery_preserved_internal_gate_failed/);
  assert.match(singleSource, /recovery_duplicate_id_in_full_state/);
});
''')

hardening = Path("tests/catalog-production-hardening.test.ts")
h = hardening.read_text()
old_test = '''test("recovery publisher has opt-in exact preservation for untouched full maintenance state", () => {
  assert.match(recoveryPublisher, /readAllOffersForMaintenance/);
  assert.match(recoveryPublisher, /RECOVERY_BATCH_PRESERVE_UNTOUCHED_EXACT/);
  assert.match(recoveryPublisher, /preservedInternalByMarket/);
  assert.match(recoveryPublisher, /preservedPublicHashByMarket/);
  assert.match(recoveryPublisher, /recovery_batch_preserved_internal_gate_failed/);
  assert.match(recoveryPublisher, /recovery_batch_preserved_manifest_mismatch/);
  assert.match(recoveryPublisher, /recovery_batch_preserved_hash_mismatch/);
});'''
new_test = '''test("recovery publisher always preserves untouched full maintenance state exactly", () => {
  assert.match(recoveryPublisher, /readAllOffersForMaintenance/);
  assert.match(recoveryPublisher, /const preserveUntouchedExact = true/);
  assert.match(recoveryPublisher, /preservedInternalByMarket/);
  assert.match(recoveryPublisher, /preservedPublicHashByMarket/);
  assert.match(recoveryPublisher, /recovery_batch_preserved_internal_gate_failed/);
  assert.match(recoveryPublisher, /recovery_batch_preserved_manifest_mismatch/);
  assert.match(recoveryPublisher, /recovery_batch_preserved_hash_mismatch/);
});'''
if old_test not in h:
    raise SystemExit("production hardening recovery test target not found")
hardening.write_text(h.replace(old_test, new_test, 1))

ci = Path(".github/workflows/ci.yml")
c = ci.read_text()
old_ci = "run: node --import tsx --test tests/catalog-production-hardening.test.ts"
new_ci = "run: node --import tsx --test tests/catalog-production-hardening.test.ts tests/catalog-recovery-publisher-min-images.test.ts"
if old_ci not in c:
    raise SystemExit("CI hardening command target not found")
ci.write_text(c.replace(old_ci, new_ci, 1))
