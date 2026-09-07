import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { publicResponseChallenge } from './lib/public-response-challenge.mjs';
import { boundedPilotInteger } from './lib/catalog-pilot-summary.mjs';
import { canaryPrefix, PRODUCTION_INPUTS, assertCanaryObjectRequest, assertProductionInputsUnchanged,
  assertStoredCardParity, sha256, jsonHash } from './lib/catalog-generation-canary.mjs';

const repoRoot = process.cwd();
const market = process.env.CANARY_MARKET;
const runId = `${process.env.GITHUB_RUN_ID || 'local'}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`;
const prefix = canaryPrefix(runId, market);
const output = path.resolve(process.env.CANARY_OUTPUT || `canary-${market}`);
const target = boundedPilotInteger(process.env.CANARY_TARGET, 8, 12);
const sampleLimit = boundedPilotInteger(process.env.CANARY_SAMPLE_LIMIT, 16, 20);
const imageLimit = boundedPilotInteger(process.env.CANARY_IMAGE_LIMIT, 8, 10);
const endpoint = process.env.YC_OBJECT_STORAGE_ENDPOINT || 'https://storage.yandexcloud.net';
const bucket = process.env.YC_OBJECT_STORAGE_BUCKET;
const storagePrefix = (process.env.YC_OBJECT_STORAGE_PREFIX || '').replace(/^\/+|\/+$/g, '');
const report = { version: 1, market, runId, codeSha: process.env.GITHUB_SHA || null,
  startedAt: new Date().toISOString(), completed: false, accepted: false, productionPublication: false,
  productionCatalogWrites: 0, diagnosticObjectWrites: 0, japanRequests: 0,
  environment: 'GitHub runner with production storage inputs; local generation and isolated object round-trip',
  sourceRequests: [], imageRequests: [], storageRequests: [], rows: [], limits: { target, sampleLimit, imageLimit },
  limitations: ['Bounded source-order sample, not full inventory readiness.',
    'The live catalog is not switched. Rollback is exercised only in the isolated local catalog.',
    'Image decoding and dimensions are automated; visual review is a separate check.'] };
await fs.mkdir(output, { recursive: true });
const checkpoint = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const originalFetch = globalThis.fetch;
const imageUrls = new Set();
let sourceStopped = false;
let currencyRequests = 0;
const sourceHost = market === 'korea' ? 'kcar.com' : 'mobile.de';
const writeKeys = new Set();
let temp;
const errorText = error => String(error?.message || error).replace(/https?:\/\/\S+/g, '[url]').slice(0, 250);

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : {}));
  if (url.origin === new URL(endpoint).origin) {
    const key = assertCanaryObjectRequest(url, method, endpoint, bucket, storagePrefix, prefix);
    report.storageRequests.push({ key, method });
    if (method === 'PUT') report.diagnosticObjectWrites++;
    return originalFetch(input, init);
  }
  if (headers.has('authorization') || headers.has('cookie') || url.protocol !== 'https:') throw new Error('canary_public_credentials_or_protocol_blocked');
  if (url.href === 'https://www.cbr.ru/scripts/XML_daily.asp' && method === 'GET' && currencyRequests++ === 0) {
    return originalFetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
  }
  const isImage = imageUrls.has(url.href);
  if (sourceStopped || method !== 'GET' && !(market === 'korea' && method === 'POST' && url.hostname === 'api.kcar.com' && url.pathname === '/bc/search/list/drct')) throw new Error('canary_source_stopped_or_method_blocked');
  const events = isImage ? report.imageRequests : report.sourceRequests;
  if (events.length >= (isImage ? 160 : 70)) throw new Error('canary_request_budget_exhausted');
  if (!isImage && !(url.hostname === sourceHost || url.hostname.endsWith(`.${sourceHost}`))) throw new Error('canary_source_host_blocked');
  const event = { url: url.href, method, at: new Date().toISOString() };
  events.push(event);
  const response = await originalFetch(url, { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  event.status = response.status;
  if ([401, 403, 429].includes(response.status)) { sourceStopped = true; throw new Error(`canary_stop_http_${response.status}`); }
  if (response.status >= 300 && response.status < 400) throw new Error('canary_redirect_requires_review');
  if (isImage) {
    if (!response.ok) return response;
    if (!/^image\/(jpeg|png|webp)(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('canary_image_not_raster');
    const reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8_000_000) { await reader.cancel(); throw new Error('canary_image_too_large'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const data = Buffer.concat(chunks);
    const decoder = sharp(data, { failOn: 'warning', limitInputPixels: 40_000_000 });
    const metadata = await decoder.metadata();
    await decoder.stats(); // Fully decode; a valid header alone is insufficient.
    if (!(metadata.width >= 640 && metadata.height >= 400)) throw new Error('canary_image_below_dimensions');
    Object.assign(event, { bytes, sha256: sha256(data), width: metadata.width, height: metadata.height, decoded: true });
    return new Response(data, { status: response.status, headers: { 'content-type': response.headers.get('content-type') } });
  }
  const body = await response.clone().text();
  event.sha256 = sha256(body);
  if (publicResponseChallenge(body)) { sourceStopped = true; throw new Error('canary_source_challenge_stop'); }
  return response;
};

try {
  for (const name of ['YC_OBJECT_STORAGE_BUCKET', 'YC_OBJECT_STORAGE_ACCESS_KEY_ID', 'YC_OBJECT_STORAGE_SECRET_ACCESS_KEY']) {
    if (!process.env[name]) throw new Error(`canary_required_setting_missing:${name}`);
  }
  const { ObjectJsonStorage, getJsonStorage } = await import('../apps/web/lib/data.ts');
  const objectStorage = new ObjectJsonStorage();
  const readInputs = async () => {
    const result = {};
    for (const key of PRODUCTION_INPUTS) {
      result[key] = await objectStorage.readJsonWithMeta(key, null);
      if (!result[key].found) throw new Error(`canary_production_input_missing:${key}`);
    }
    return result;
  };
  const before = await readInputs();
  const { selectActiveMarketVersion } = await import('../apps/web/lib/business-settings.ts');
  const { resolveEffectiveMarketVersion } = await import('../apps/web/lib/effective-market-settings.ts');
  const rawMarket = before['markets/markets.json'].value.find(row => row.id === market);
  const activeVersion = selectActiveMarketVersion(rawMarket);
  if (!activeVersion?.id) throw new Error('canary_active_crm_version_missing');
  const effective = resolveEffectiveMarketVersion(market, activeVersion);
  report.businessSettings = { rawActiveVersion: activeVersion.id, effectiveVersion: effective.id,
    rawActiveHash: jsonHash(activeVersion), effectiveHash: jsonHash(effective),
    effectiveExpenses: Object.fromEntries(Object.entries(effective).filter(([key]) => /Rub$|Percent$|^provisional$/.test(key))) };
  report.productionBaseline = Object.fromEntries(PRODUCTION_INPUTS.map(key => [key,
    { etag: before[key].etag, sha256: jsonHash(before[key].value) }]));
  report.rollback = { productionManifest: before['catalog/manifest.json'].value,
    productionManifestEtag: before['catalog/manifest.json'].etag, productionSwitchPerformed: false };
  await checkpoint();

  // Reference data stays bundled with this exact commit. Runtime files and all
  // generated objects live in a new temporary root, never in the checkout.
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'avtocena-canary-'));
  const dataRoot = path.join(temp, 'data');
  await fs.mkdir(path.join(dataRoot, 'catalog'), { recursive: true });
  const readOnlyCatalog = new Set();
  for (const entry of await fs.readdir(path.join(repoRoot, 'data/catalog'), { withFileTypes: true })) {
    if (['research', 'imports', 'manifest.json', 'generations', 'internal', 'public', 'images', 'canaries', 'japan-auction-history'].includes(entry.name)) continue;
    readOnlyCatalog.add(entry.name);
    await fs.symlink(path.join(repoRoot, 'data/catalog', entry.name), path.join(dataRoot, 'catalog', entry.name));
  }
  for (const key of ['markets/markets.json', 'fees/exchange-rates.json']) {
    await fs.mkdir(path.dirname(path.join(dataRoot, key)), { recursive: true });
    await fs.writeFile(path.join(dataRoot, key), JSON.stringify(before[key].value));
  }
  process.chdir(temp);
  process.env.JSON_STORAGE_DRIVER = 'local';
  process.env.CATALOG_IMAGE_STORAGE_MODE = 'source_urls_only';
  process.env.CATALOG_IMAGE_CDN_URL = '';
  process.env.CATALOG_SOURCE_RETRY_ATTEMPTS = '1';
  process.env.CATALOG_SOURCE_DETAIL_BATCH_SIZE = '1';
  process.env.CATALOG_GROW_ONLY_MARKETS = '';
  const local = getJsonStorage();
  if (local.driver !== 'local') throw new Error('canary_requires_isolated_local_storage');
  for (const method of ['writeJson', 'putBinary', 'deleteJson', 'deleteBinary', 'deleteObjects', 'deletePrefix']) {
    const original = local[method]?.bind(local);
    if (!original) continue;
    local[method] = async (key, ...args) => {
      if (Array.isArray(key) || !key.startsWith('catalog/') || key.includes('..') || key.includes('\\')
        || readOnlyCatalog.has(key.split('/')[1]) || method.startsWith('delete')) throw new Error('canary_local_write_blocked');
      writeKeys.add(key);
      return original(key, ...args);
    };
  }
  const { persistCatalogOffers, getOffer, searchOffers, searchProjectionFromOffer, projectionCanRenderCard,
    cacheImageFromUrl, assertSafeImageUrl, resetCatalogReadCachesForTests, CATALOG_PRODUCTION_WRITES_PAUSED } = await import('../apps/web/lib/catalog/storage.ts');
  if (!CATALOG_PRODUCTION_WRITES_PAUSED) throw new Error('canary_requires_production_pause');
  const { calculateOfferWithVerifiedSpecifications } = await import('../apps/web/lib/catalog/customs-pricing.ts');
  const { enrichOfferForDisplay } = await import('../apps/web/lib/catalog/display-enrichment.ts');
  const { isCrediblePublicOffer, isCatalogYearAllowed } = await import('../apps/web/lib/catalog/offer-quality.ts');
  const { catalogPublicPriority, catalogOfferVisibleRub } = await import('../apps/web/lib/catalog/public-priority.ts');
  const { deduplicatePublicCatalogOffers } = await import('../apps/web/lib/catalog/public-offer-deduplication.ts');
  const source = market === 'korea' ? (await import('../apps/web/lib/catalog/kcar-exact-source.ts')).kcarKoreaExactSource
    : (await import('../apps/web/lib/catalog/mobile-de-exact-source.ts')).mobileDeExactSource;
  const auditOffer = async offer => {
    const priced = await calculateOfferWithVerifiedSpecifications(offer);
    if (!(priced.totalRub > 0)) throw new Error(`canary_calculation_${priced.calculationStatus}`);
    const displayed = await enrichOfferForDisplay(priced);
    if (!isCrediblePublicOffer(displayed) || !catalogPublicPriority(displayed).eligible
      || !projectionCanRenderCard(searchProjectionFromOffer(displayed))) throw new Error('canary_public_quality_failed');
    assertStoredCardParity(displayed, searchProjectionFromOffer(displayed), displayed, effective.id, catalogOfferVisibleRub);
    return displayed;
  };
  const page = await source.fetchPage('1');
  report.page = { returnedRows: page.items.length, diagnostics: page.diagnostics, health: page.health };
  const accepted = []; const seen = new Set();
  for (const raw of page.items.slice(0, sampleLimit)) {
    if (sourceStopped || accepted.length >= target) break;
    let offer = source.normalizeOffer(raw);
    const row = { sourceOfferId: offer?.sourceOfferId || raw?.id || null, accepted: false, images: [] };
    report.rows.push(row);
    try {
      if (!offer) throw new Error('canary_normalization_rejected');
      const identity = `${offer.sourceId}:${offer.sourceOfferId}`;
      if (seen.has(identity)) throw new Error('canary_duplicate_source_identity');
      seen.add(identity);
      offer.images = await source.fetchImages(offer);
      if (!isCatalogYearAllowed(offer.year, market)) throw new Error('canary_year_not_allowed');
      offer = await auditOffer(offer);
      row.beforeRefresh = { price: offer.sourcePrice, totalRub: offer.totalRub, year: offer.year };
      const cached = []; const originalUrls = [];
      for (const candidate of offer.images.slice(0, imageLimit)) {
        if (sourceStopped) break;
        const url = assertSafeImageUrl(candidate.url);
        imageUrls.add(new URL(url).href);
        const image = await cacheImageFromUrl(url, market);
        if (!image || !image.width || !image.height) { row.images.push({ url, accepted: false }); continue; }
        if (cached.some(previous => previous.checksum === image.checksum)) { row.images.push({ url, accepted: false, duplicate: true }); continue; }
        cached.push(image); originalUrls.push(url);
        await fs.mkdir(path.dirname(path.join(output, image.objectKey)), { recursive: true });
        await fs.copyFile(path.join(dataRoot, image.objectKey), path.join(output, image.objectKey));
        row.images.push({ url, accepted: true, checksum: image.checksum, width: image.width, height: image.height, size: image.size });
        if (cached.length >= 5) break;
      }
      if (cached.length < 5) throw new Error('canary_fewer_than_five_decoded_images');
      // A new KCar request refreshes status, price and characteristics, not only
      // gallery links. mobile.de fetchImages already re-reads the identity-bound VIP.
      if (market === 'korea') offer = await source.refreshOffer(offer);
      else offer.images = await source.fetchImages(offer);
      const currentUrls = new Set(offer.images.map(image => image.url));
      if (originalUrls.some(url => !currentUrls.has(url))) throw new Error('canary_gallery_changed_during_download');
      offer.images = cached;
      offer = await auditOffer(offer);
      row.refreshedAt = new Date().toISOString();
      Object.assign(row, { accepted: true, id: offer.id, year: offer.year, sourcePrice: offer.sourcePrice,
        totalRub: offer.totalRub, businessConfigVersion: offer.calculationSnapshot.businessConfigVersion });
      accepted.push(offer);
    } catch (error) { row.error = errorText(error); }
    await checkpoint();
  }
  if (sourceStopped) throw new Error('canary_stopped_by_source_response');
  const dedup = deduplicatePublicCatalogOffers(accepted);
  report.duplicates = dedup.removed;
  if (!dedup.rows.length) throw new Error('canary_no_accepted_rows');
  // Exercise the actual serializer, indexes, readers and rollback in isolation.
  const first = await persistCatalogOffers(dedup.rows.slice(0, 1));
  const manifest = await persistCatalogOffers(dedup.rows);
  const stored = await searchOffers({ market, page: 1, pageSize: 50 });
  if (stored.total !== dedup.rows.length) throw new Error(`canary_persisted_count_mismatch:${stored.total}:${dedup.rows.length}`);
  report.storedCards = [];
  for (const expected of dedup.rows) {
    const card = stored.items.find(row => row.id === expected.id);
    const detail = await getOffer(expected.id);
    report.storedCards.push(assertStoredCardParity(detail, card, expected, effective.id, catalogOfferVisibleRub));
    for (const image of detail.images) {
      const bytes = await local.getBinary(image.objectKey);
      if (bytes.checksum !== image.checksum) throw new Error('canary_local_image_checksum_mismatch');
    }
  }
  await local.writeJson('catalog/manifest.json', first);
  resetCatalogReadCachesForTests();
  const rolledBack = await searchOffers({ market, page: 1, pageSize: 50 });
  if (rolledBack.generationId !== first.generationId || rolledBack.total !== 1 || !(await getOffer(dedup.rows[0].id))) throw new Error('canary_local_rollback_failed');
  if (dedup.rows.length > 1 && await getOffer(dedup.rows[1].id)) throw new Error('canary_rollback_leaks_new_offer');
  await local.writeJson('catalog/manifest.json', manifest);
  resetCatalogReadCachesForTests();
  if ((await searchOffers({ market, page: 1, pageSize: 50 })).total !== dedup.rows.length) throw new Error('canary_local_restore_failed');
  Object.assign(report.rollback, { isolatedRollbackPassed: true, baselineGeneration: first.generationId, candidateGeneration: manifest.generationId });
  report.generation = manifest;
  assertProductionInputsUnchanged(before, await readInputs());
  report.files = [];
  for (const key of [...writeKeys].sort()) {
    const data = await fs.readFile(path.join(dataRoot, key));
    const remoteKey = `${prefix}${key}`;
    const mime = key.endsWith('.json') ? 'application/json' : key.endsWith('.webp') ? 'image/webp' : 'application/octet-stream';
    const storedObject = await objectStorage.putBinary(remoteKey, data, mime, { ifNoneMatch: '*' });
    const roundTrip = await objectStorage.getBinary(remoteKey);
    if (storedObject.checksum !== sha256(data) || roundTrip.checksum !== sha256(data)) throw new Error('canary_object_roundtrip_mismatch');
    report.files.push({ key: remoteKey, sha256: sha256(data), bytes: data.length });
    if (report.files.length % 20 === 0) await checkpoint();
    // Keep a small reviewable artifact, including the actual decoded photographs.
    if (key.startsWith('catalog/images/') || key === 'catalog/manifest.json' || key.startsWith('catalog/public/')) {
      await fs.mkdir(path.dirname(path.join(output, key)), { recursive: true });
      await fs.writeFile(path.join(output, key), data);
    }
  }
  assertProductionInputsUnchanged(before, await readInputs());
  report.productionInputsUnchanged = true;
  report.accepted = true;
  report.completed = true;
  report.finishedAt = new Date().toISOString();
  await checkpoint();
  await objectStorage.writeJson(`${prefix}report.json`, report, { ifNoneMatch: '*' });
  console.log(JSON.stringify({ market, accepted: true, examined: report.rows.length, stored: report.storedCards.length,
    decodedImages: report.imageRequests.filter(row => row.decoded).length, diagnosticObjects: report.files.length,
    isolatedRollbackPassed: report.rollback.isolatedRollbackPassed, productionInputsUnchanged: true }));
} catch (error) {
  report.accepted = false;
  report.error = errorText(error);
  report.completed = true;
  report.finishedAt = new Date().toISOString();
  process.exitCode = 1;
  await checkpoint();
  console.error(JSON.stringify({ market, error: report.error }));
} finally {
  process.chdir(repoRoot);
  globalThis.fetch = originalFetch;
  // The diagnostic report records partial writes and their unique run prefix.
  // No remote cleanup or production rollback is performed by this command.
}
