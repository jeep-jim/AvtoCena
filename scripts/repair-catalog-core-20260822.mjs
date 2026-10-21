import fs from "node:fs/promises";

async function read(file) { return fs.readFile(file, "utf8"); }
async function write(file, value) { await fs.writeFile(file, value); }
function replaceOnce(text, from, to, label) {
  const index = text.indexOf(from);
  if (index < 0) throw new Error(`repair_marker_missing:${label}`);
  if (text.indexOf(from, index + from.length) >= 0) throw new Error(`repair_marker_ambiguous:${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

const storagePath = "apps/web/lib/catalog/storage.ts";
let storage = await read(storagePath);

const persistOptionsMarker = "export type PersistCatalogOptions = {";
const readinessHelper = `async function assertCurrentCatalogReadModelsReady(generationId: string, offers: VehicleOffer[]) {\n  const all = await readDataJson<{ generationId: string; items: CatalogSearchProjection[] }>(\n    currentProjectionPath(CURRENT_ALL_MARKETS_PROJECTION),\n    { generationId: \"\", items: [] },\n  );\n  if (all.generationId !== generationId || Number(all.items?.length || 0) !== offers.length) {\n    throw new Error(\`catalog_current_projection_not_ready:\${all.generationId}:\${Number(all.items?.length || 0)}:\${generationId}:\${offers.length}\`);\n  }\n  const byMarket = new Map<string, VehicleOffer[]>();\n  for (const offer of offers) byMarket.set(String(offer.market || \"\"), [...(byMarket.get(String(offer.market || \"\")) || []), offer]);\n  for (const [market, rows] of byMarket) {\n    const projection = await readDataJson<{ generationId: string; items: CatalogSearchProjection[] }>(\n      currentProjectionPath(market),\n      { generationId: \"\", items: [] },\n    );\n    if (projection.generationId !== generationId || Number(projection.items?.length || 0) !== rows.length) {\n      throw new Error(\`catalog_current_market_projection_not_ready:\${market}:\${projection.generationId}:\${Number(projection.items?.length || 0)}:\${generationId}:\${rows.length}\`);\n    }\n    for (const offer of rows.slice(0, 5)) {\n      const shard = await readDataJson<{ generationId: string; items: VehicleOffer[] }>(\n        currentOfferShardPath(offer.id),\n        { generationId: \"\", items: [] },\n      );\n      if (shard.generationId !== generationId || !(shard.items || []).some((item) => item.id === offer.id)) {\n        throw new Error(\`catalog_current_offer_shard_not_ready:\${market}:\${offer.id}:\${shard.generationId}:\${generationId}\`);\n      }\n    }\n  }\n}\n\n`;
if (!storage.includes("async function assertCurrentCatalogReadModelsReady")) {
  storage = replaceOnce(storage, persistOptionsMarker, readinessHelper + persistOptionsMarker, "storage_readiness_helper");
}

const oldSwitch = `  const manifest: CatalogManifest = { version: 2, generationId, updatedAt: now, markets };\n  for (let attempt = 0; attempt < 5; attempt++) {\n    const current = await storage.readJsonWithMeta<CatalogManifest>(\"catalog/manifest.json\", manifest);\n    try {\n      await storage.writeJson(\"catalog/manifest.json\", manifest, current.found && current.etag ? { ifMatch: current.etag } : { ifNoneMatch: \"*\" });\n      resetCatalogReadCachesForTests();\n      await writeCurrentCatalogReadModels(generationId, publishedOffers, true);\n      resetCatalogReadCachesForTests();\n      return manifest;\n    }\n    catch (e) { if (e instanceof StorageConflictError) continue; throw e; }\n  }\n  throw new StorageConflictError();`;
const newSwitch = `  const manifest: CatalogManifest = { version: 2, generationId, updatedAt: now, markets };\n  // Stage every one-hop read model before the public manifest cutover. Readers\n  // compare each read model with the still-current manifest, so while staging\n  // they safely fall back to the previous immutable generation. Only after the\n  // projections AND full offer-detail shards are verified do we expose the new\n  // generation. This prevents cards from pointing at temporarily unavailable\n  // /cars/offer/:id pages.\n  await writeCurrentCatalogReadModels(generationId, publishedOffers, true);\n  await assertCurrentCatalogReadModelsReady(generationId, publishedOffers);\n  for (let attempt = 0; attempt < 5; attempt++) {\n    const current = await storage.readJsonWithMeta<CatalogManifest>(\"catalog/manifest.json\", manifest);\n    try {\n      await storage.writeJson(\"catalog/manifest.json\", manifest, current.found && current.etag ? { ifMatch: current.etag } : { ifNoneMatch: \"*\" });\n      resetCatalogReadCachesForTests();\n      return manifest;\n    }\n    catch (e) { if (e instanceof StorageConflictError) continue; throw e; }\n  }\n  throw new StorageConflictError();`;
if (storage.includes(oldSwitch)) storage = replaceOnce(storage, oldSwitch, newSwitch, "storage_atomic_cutover");
else if (!storage.includes("await assertCurrentCatalogReadModelsReady(generationId, publishedOffers);")) throw new Error("repair_marker_missing:storage_atomic_cutover");
await write(storagePath, storage);

const offerDataPath = "apps/web/lib/catalog/offer-page-data.ts";
let offerData = await read(offerDataPath);
const oldOfferLoader = `// Metadata and the page render also share the lookup inside one request.\nexport const getOfferForPage = cache((id: string) => getOfferAcrossRequests(id));`;
const newOfferLoader = `async function resilientOfferLookup(id: string) {\n  // A cached miss must never poison a live offer page for a full revalidation\n  // window. During a publication cutover or transient storage read failure,\n  // retry the authoritative reader once outside unstable_cache.\n  try {\n    const cached = await getOfferAcrossRequests(id);\n    if (cached) return cached;\n  } catch {\n    // Fall through to the authoritative retry below.\n  }\n  return getOffer(id);\n}\n\n// Metadata and the page render also share the lookup inside one request.\nexport const getOfferForPage = cache((id: string) => resilientOfferLookup(id));`;
if (offerData.includes(oldOfferLoader)) offerData = replaceOnce(offerData, oldOfferLoader, newOfferLoader, "offer_page_resilient_lookup");
else if (!offerData.includes("resilientOfferLookup")) throw new Error("repair_marker_missing:offer_page_resilient_lookup");
await write(offerDataPath, offerData);

const navTestPath = "tests/offer-navigation-performance.test.ts";
let navTest = await read(navTestPath);
const oldOrder = `  assert.ok(manifestSwitch > 0);\n  assert.ok(currentReadModelRefresh > manifestSwitch);\n  assert.match(storage, /current\\.generationId === manifest\\.generationId/);`;
const newOrder = `  assert.ok(manifestSwitch > 0);\n  assert.ok(currentReadModelRefresh > 0);\n  assert.ok(currentReadModelRefresh < manifestSwitch);\n  assert.match(storage, /assertCurrentCatalogReadModelsReady\\(generationId, publishedOffers\\)/);\n  assert.match(storage, /current\\.generationId === manifest\\.generationId/);`;
if (navTest.includes(oldOrder)) navTest = replaceOnce(navTest, oldOrder, newOrder, "navigation_atomic_order");
else if (!navTest.includes("currentReadModelRefresh < manifestSwitch")) throw new Error("repair_marker_missing:navigation_atomic_order");
await write(navTestPath, navTest);

const workflowPath = ".github/workflows/catalog-v3-market-10k-reusable.yml";
let workflow = await read(workflowPath);
const auditMarker = `      - name: Audit published market\n        env:`;
const verifyStep = `      - name: Verify offer detail read models\n        env:\n          CATALOG_AUDIT_ASSERT_MARKETS: \${{ inputs.market }}\n          CATALOG_OFFER_DETAIL_VERIFY_OUTPUT: catalog-v3-\${{ inputs.market }}-offer-detail-verify.json\n        run: npx tsx scripts/catalog-verify-current-offers.mjs\n      - name: Audit published market\n        env:`;
if (!workflow.includes("Verify offer detail read models")) workflow = replaceOnce(workflow, auditMarker, verifyStep, "workflow_offer_detail_verify");
const artifactMarker = `            catalog-v3-\${{ inputs.market }}-postpublish-audit.json`;
if (!workflow.includes("catalog-v3-${{ inputs.market }}-offer-detail-verify.json")) {
  workflow = replaceOnce(workflow, artifactMarker, `${artifactMarker}\n            catalog-v3-\${{ inputs.market }}-offer-detail-verify.json`, "workflow_offer_detail_artifact");
}
await write(workflowPath, workflow);

console.log("catalog core publication repair applied");
