import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {gzipSync, gunzipSync} from 'node:zlib';
import {getDataRoot, getJsonStorage} from '../../apps/web/lib/data.ts';
import {withCatalogFxBatch, verifyCatalogFxReadback} from '../../apps/web/lib/catalog/rates.ts';
import {withCatalogEditorialSnapshot, readCatalogEditorialFresh} from '../../apps/web/lib/catalog/editorial.ts';
import {readCalculationIndex} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {DELIVERY_TARIFF_VERSION, quoteCityDelivery} from '../../apps/web/lib/catalog/city-delivery.ts';
import {buildChinaQueryIndex} from './query-index.mjs';
import {createChinaQuerySemantics} from './query-semantics.mjs';
import {enrichAndAdmitChinaOffer, prepareChinaCalculation, freezeChinaPriceBatch, preparedChinaCityPatch,
  applyPreparedChinaCityPatch, chinaCanonicalOrderKeys, pricingDigest} from './pricing-worker-prices.mjs';

const SHA = /^[a-f0-9]{64}$/;
const need = (value, reason) => assert(value, 'china_pricing_generation_' + reason);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const BATCH_ROWS = 64; // Bound working rows, never the inventory or number of pages.
const OUTPUTS = Object.freeze({details: 'details.sqlite', query: 'query.sqlite', semantics: 'FILTER_SEMANTICS.json',
  fx: 'FX_RECEIPT.json', dispositions: 'DISPOSITIONS.ndjson', reconciliation: 'RECONCILIATION.json', manifest: 'GENERATION.json'});

async function sealFile(filename) {
  const before = await fs.lstat(filename);
  need(before.isFile() && !before.isSymbolicLink() && before.nlink === 1, 'file_type');
  const digest = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(filename)) { digest.update(chunk); bytes += chunk.length; }
  const after = await fs.lstat(filename);
  need(before.dev === after.dev && before.ino === after.ino && before.size === bytes && after.size === bytes &&
    before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'file_changed');
  return {name: path.basename(filename), bytes, sha256: digest.digest('hex')};
}

async function verifyContext(context) {
  const receipt = context?.receipt;
  need(receipt?.version === 1 && receipt.kind === 'china-verified-pricing-context-v1' && receipt.market === 'china' &&
    /^[a-f0-9]{40}$/.test(receipt.runtimeSha ?? '') && SHA.test(receipt.calculationVersion ?? '') &&
    SHA.test(context.receiptSha256 ?? '') && pricingDigest(receipt) === context.receiptSha256 && Array.isArray(receipt.files) &&
    receipt.effectiveInputsRechecked === true && SHA.test(receipt.encyclopedia?.digest ?? '') &&
    SHA.test(receipt.encyclopedia?.indexSha256 ?? ''), 'context_receipt');
  need(process.env.JSON_STORAGE_DRIVER === 'local' && getJsonStorage().driver === 'local' &&
    path.resolve(getDataRoot()) === path.join(process.cwd(), 'data') && await fs.realpath(process.cwd()) === process.cwd(), 'local_context');
  const expected = new Set(['data/markets/markets.json', 'data/fees/exchange-rates.json', 'data/catalog-editorial/current.json',
    'data/catalog/china-cny-prices/current.json', 'data/knowledge/encyclopedia/calculation-v1.json']);
  need(receipt.files.length === expected.size && receipt.files.every(file => expected.delete(file.file)) && expected.size === 0,
    'context_files');
  for (const file of receipt.files) {
    need(SHA.test(file.sha256 ?? '') && positiveInteger(file.bytes), 'context_file');
    const filename = path.join(process.cwd(), file.file);
    need(await fs.realpath(filename) === filename, 'context_file_scope');
    const actual = await sealFile(filename);
    need(actual.bytes === file.bytes && actual.sha256 === file.sha256, 'context_file_changed');
  }
  const stored = await fs.readFile(path.join(process.cwd(), 'RUNTIME_CONTEXT.json'));
  need(hash(stored) === context.receiptSha256, 'context_receipt_changed');
}

function verifyFx(fx, context) {
  verifyCatalogFxReadback(fx, fx?.receipt, fx?.receiptSha256);
  const at = Date.parse(fx.receipt.pricingAsOf);
  need(fx.receipt.market === 'china' && Number.isFinite(at) && Array.isArray(context.receipt.currencies) &&
    context.receipt.currencies.every(currency => Object.hasOwn(fx.receipt.rates, currency)), 'fx_scope');
  for (const rate of Object.values(fx.receipt.rates)) {
    const date = Date.parse(rate.rateDate);
    need(Number.isFinite(date) && at - date <= 4 * 86400000 && date - at <= 86400000, 'fx_stale');
  }
}

/** The controller restores/source-refreshes and materializes inputs, then calls
 * this function in a dedicated local-storage process. It captures FX BEFORE
 * this call, and can deny all network afterwards. No provider, remote storage,
 * activation, cleanup or credential capability enters this worker. */
export async function buildChinaPricingGeneration({source, context, fxBatch, semanticModels, generationId, outputDirectory,
  onProgress = () => {}, assertInputs = async () => {}}) {
  need(source?.manifest?.market === 'china' && typeof source.offers === 'function' && positiveInteger(source.reconciliation?.sourceRows) &&
    Number.isSafeInteger(source.manifest.source?.cursor) && source.manifest.source.cursor >= 0 &&
    Number.isFinite(Date.parse(source.manifest.sourceObservedAt)) && /^gen_[a-zA-Z0-9_-]{1,180}$/.test(generationId ?? '') &&
    Array.isArray(semanticModels) && typeof onProgress === 'function' && typeof assertInputs === 'function', 'arguments');
  need(path.isAbsolute(outputDirectory) && path.resolve(outputDirectory) === outputDirectory &&
    outputDirectory !== process.cwd() && !outputDirectory.startsWith(path.resolve(getDataRoot()) + path.sep) &&
    await fs.realpath(path.dirname(outputDirectory)) === path.dirname(outputDirectory), 'output_directory');
  await verifyContext(context); verifyFx(fxBatch, context); await assertInputs();
  const sourceSeal = pricingDigest(source.manifest), contextSeal = context.receiptSha256;
  const expectedSourceRows = source.reconciliation.sourceRows;
  const editorial = await readCatalogEditorialFresh(), encyclopedia = readCalculationIndex();
  need(encyclopedia?.digest === context.receipt.encyclopedia.digest &&
    pricingDigest(editorial) === context.receipt.files.find(file => file.file === 'data/catalog-editorial/current.json').sha256, 'runtime_inputs');
  await fs.mkdir(outputDirectory, {mode: 0o700});
  const paths = Object.fromEntries(Object.entries(OUTPUTS).map(([key, name]) => [key, path.join(outputDirectory, name)]));
  const db = new DatabaseSync(paths.details, {allowExtension: false}); await fs.chmod(paths.details, 0o600);
  const dispositions = await fs.open(paths.dispositions, 'wx', 0o600);
  let closed = false, ledgerClosed = false, completed = false;
  const counts = {sourceRows: 0, admittedRows: 0, excludedRows: 0, pricedRows: 0, sellerOnlyRows: 0, unpricedRows: 0,
    missingPhotoRows: 0, missingIdentityRows: 0, editorialChangedRows: 0, encyclopediaChangedRows: 0,
    cityPatchJsonBytes: 0, cityPatchStoredBytes: 0, maxCityMapJsonBytes: 0, excluded: {}};
  const sourceRowsHash = createHash('sha256').update('china-pricing-source-rows-v1\n');
  const detailsHash = createHash('sha256').update('china-pricing-details-v1\n');
  const citiesHash = createHash('sha256').update('china-pricing-city-ledgers-v1\n');
  const preliminarySemantics = createChinaQuerySemantics({models: semanticModels, modelPairs: [], pricingAsOf: fxBatch.receipt.pricingAsOf});
  const cityKeys = preliminarySemantics.cityKeys, cities = preliminarySemantics.cities;
  const checkInputs = async () => {
    need(pricingDigest(source.manifest) === sourceSeal && pricingDigest(context.receipt) === contextSeal, 'input_descriptor_changed');
    await assertInputs();
  };
  const writeJson = async (filename, value) => {
    await fs.writeFile(filename, JSON.stringify(value), {flag: 'wx', mode: 0o600});
    return sealFile(filename);
  };
  try {
    db.exec(`PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA temp_store=FILE;
      CREATE TABLE offers(id TEXT PRIMARY KEY,full_json TEXT NOT NULL,full_sha256 TEXT NOT NULL,
        projection_json TEXT NOT NULL,projection_sha256 TEXT NOT NULL,canonical_ordinal INTEGER UNIQUE);
      CREATE TABLE city_ledgers(id TEXT PRIMARY KEY,patches_gzip BLOB NOT NULL,patches_sha256 TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE ordering(id TEXT PRIMARY KEY,make TEXT NOT NULL,model TEXT NOT NULL,calculated INTEGER NOT NULL,
        display_group INTEGER NOT NULL,expensive_price REAL NOT NULL,low_power INTEGER NOT NULL,freshness REAL NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE source_seen(id TEXT PRIMARY KEY);
      BEGIN;`);
    const see = db.prepare('INSERT INTO source_seen VALUES(?)');
    const put = db.prepare('INSERT INTO offers VALUES(?,?,?,?,?,NULL)');
    const putCity = db.prepare('INSERT INTO city_ledgers VALUES(?,?,?)');
    const order = db.prepare('INSERT INTO ordering VALUES(?,?,?,?,?,?,?,?,?)');
    let pending = [], nextProgressAt = 1000;
    const flush = async () => {
      if (!pending.length) return;
      const rows = await freezeChinaPriceBatch(pending.map(row => row.calculating), fxBatch);
      for (const [index, prepared] of rows.entries()) {
        const {full, projection, priceState} = prepared, entry = pending[index];
        const fullJson = JSON.stringify(full), projectionJson = JSON.stringify(projection), fullSha = hash(fullJson), projectionSha = hash(projectionJson);
        put.run(full.id, fullJson, fullSha, projectionJson, projectionSha);
        const keys = chinaCanonicalOrderKeys(projection);
        order.run(full.id, String(projection.make || ''), String(projection.model || ''), keys.calculated, keys.group,
          keys.expensivePrice, keys.lowPower, keys.freshness, keys.updatedAt);
        detailsHash.update(JSON.stringify([full.id, fullSha, projectionSha]) + '\n');
        const cityPatches = {};
        for (const city of cities) {
          const patch = preparedChinaCityPatch(full, projection, city.city), patchJson = JSON.stringify(patch), patchSha = hash(patchJson);
          // Verify the full resulting ledger now, never on a visitor request.
          if (projection.totalRub) {
            const delivered = applyPreparedChinaCityPatch(full, patch);
            need(delivered.totalRub === patch.offer.totalRub && delivered.calculationSnapshot.breakdown
              .reduce((sum, line) => sum + line.amountRub, 0) === delivered.totalRub, 'city_readback');
          }
          cityPatches[city.key] = patch;
          citiesHash.update(JSON.stringify([full.id, city.key, patchSha]) + '\n');
        }
        const mapJson = JSON.stringify(cityPatches), packed = gzipSync(mapJson, {level: 1});
        need(gunzipSync(packed).toString('utf8') === mapJson, 'city_compression_readback');
        putCity.run(full.id, packed, hash(mapJson));
        counts.cityPatchJsonBytes += Buffer.byteLength(mapJson); counts.cityPatchStoredBytes += packed.length;
        counts.maxCityMapJsonBytes = Math.max(counts.maxCityMapJsonBytes, Buffer.byteLength(mapJson));
        counts.admittedRows++;
        counts[priceState === 'priced' ? 'pricedRows' : priceState === 'seller_only' ? 'sellerOnlyRows' : 'unpricedRows']++;
        if (!projection.cardImageUrl) counts.missingPhotoRows++;
        if (!projection.make || !projection.model) counts.missingIdentityRows++;
        await dispositions.writeFile(JSON.stringify({...entry.disposition, decision: 'admitted', priceState,
          detailSha256: fullSha, projectionSha256: projectionSha}) + '\n');
      }
      pending = [];
      db.exec('COMMIT; BEGIN;');
      if (counts.sourceRows >= nextProgressAt || counts.sourceRows === expectedSourceRows) {
        await checkInputs();
        await onProgress({phase: 'china_frozen_pricing', sourceRows: counts.sourceRows, admittedRows: counts.admittedRows,
          excludedRows: counts.excludedRows, pricedRows: counts.pricedRows, sellerOnlyRows: counts.sellerOnlyRows, unpricedRows: counts.unpricedRows});
        nextProgressAt = counts.sourceRows + 1000;
      }
    };
    await withCatalogFxBatch(fxBatch, () => withCatalogEditorialSnapshot(editorial, async () => {
      for await (const input of source.offers({eligibleOnly: false})) {
        const decision = enrichAndAdmitChinaOffer(input, {editorial, encyclopedia, pricingAsOf: fxBatch.receipt.pricingAsOf});
        see.run(input.id); counts.sourceRows++;
        const sourcePayloadSha256 = pricingDigest(input);
        sourceRowsHash.update(JSON.stringify([input.id, sourcePayloadSha256]) + '\n');
        if (decision.editorialApplied) counts.editorialChangedRows++;
        if (decision.encyclopediaApplied) counts.encyclopediaChangedRows++;
        const disposition = {id: input.id, sourcePayloadSha256, enrichedPayloadSha256: pricingDigest(decision.offer),
          year: Number.isInteger(decision.offer.year) ? decision.offer.year : null};
        if (decision.reason) {
          counts.excludedRows++; counts.excluded[decision.reason] = (counts.excluded[decision.reason] || 0) + 1;
          await dispositions.writeFile(JSON.stringify({...disposition, decision: 'excluded', reason: decision.reason}) + '\n');
        } else pending.push({disposition, calculating: await prepareChinaCalculation(decision.offer)});
        if (pending.length >= BATCH_ROWS) await flush();
        else if (counts.sourceRows % 1000 === 0) { db.exec('COMMIT; BEGIN;'); await checkInputs(); }
      }
      await flush();
    }));
    db.exec('COMMIT');
    need(counts.sourceRows === expectedSourceRows && source.reconciliation.sourceRows === expectedSourceRows &&
      counts.sourceRows === counts.admittedRows + counts.excludedRows &&
      counts.admittedRows === counts.pricedRows + counts.sellerOnlyRows + counts.unpricedRows && counts.admittedRows > 0 &&
      db.prepare('SELECT COUNT(*) n FROM source_seen').get().n === counts.sourceRows &&
      db.prepare('SELECT COUNT(*) n FROM offers').get().n === counts.admittedRows &&
      db.prepare('SELECT COUNT(*) n FROM city_ledgers').get().n === counts.admittedRows, 'census');
    await dispositions.sync(); await dispositions.close(); ledgerClosed = true;
    const modelPairs = db.prepare("SELECT DISTINCT make,model FROM ordering WHERE make<>'' AND model<>'' ORDER BY make,model").all();
    const semantics = createChinaQuerySemantics({models: semanticModels, modelPairs, pricingAsOf: fxBatch.receipt.pricingAsOf});
    need(JSON.stringify(semantics.cityKeys) === JSON.stringify(cityKeys), 'city_set_changed');
    const semanticFile = await writeJson(paths.semantics, semantics.receipt);
    const fxFile = await writeJson(paths.fx, {receipt: fxBatch.receipt, receiptSha256: fxBatch.receiptSha256});
    const binding = {version: 1, market: 'china', generationId, sourceSha256: sourceSeal,
      pricingReceiptSha256: fxBatch.receiptSha256, calculationVersion: context.receipt.calculationVersion,
      encyclopediaSha256: context.receipt.encyclopedia.indexSha256,
      editorialSha256: context.receipt.files.find(file => file.file === 'data/catalog-editorial/current.json').sha256,
      deliveryTariffSha256: pricingDigest({version: DELIVERY_TARIFF_VERSION, quotes: cities.map(city => [city.key, quoteCityDelivery(city.city, 'china')])}),
      filterSemanticsSha256: semantics.receiptSha256, sourceCursor: source.manifest.source.cursor,
      sourceObservedAt: source.manifest.sourceObservedAt, pricingAsOf: fxBatch.receipt.pricingAsOf};
    const get = db.prepare('SELECT full_json,full_sha256,projection_json,projection_sha256 FROM offers WHERE id=?');
    const getCities = db.prepare('SELECT patches_gzip,patches_sha256 FROM city_ledgers WHERE id=?');
    const setOrdinal = db.prepare('UPDATE offers SET canonical_ordinal=? WHERE id=?');
    const rows = async function* () {
      let ordinal = 0;
      const selection = db.prepare(`SELECT id FROM ordering ORDER BY calculated DESC,display_group ASC,
        expensive_price ASC,low_power DESC,freshness DESC,updated_at DESC,id COLLATE BINARY`);
      for (const {id} of selection.iterate()) {
        const saved = get.get(id);
        need(saved && hash(saved.full_json) === saved.full_sha256 && hash(saved.projection_json) === saved.projection_sha256, 'prepared_row_changed');
        const full = JSON.parse(saved.full_json), projection = JSON.parse(saved.projection_json), cityPrices = {};
        const baseLedger = projection.totalRub ? pricingDigest(full.calculationSnapshot) : null;
        const city = getCities.get(id), mapJson = gunzipSync(city.patches_gzip).toString('utf8');
        need(hash(mapJson) === city.patches_sha256, 'prepared_city_changed');
        const patches = JSON.parse(mapJson);
        need(JSON.stringify(Object.keys(patches)) === JSON.stringify(cityKeys), 'prepared_city_coverage');
        for (const [key, patch] of Object.entries(patches)) {
          cityPrices[key] = {totalRub: projection.totalRub ? patch.offer.totalRub : null,
            ledgerSha256: projection.totalRub ? pricingDigest(['china-city-ledger-v1', baseLedger, pricingDigest(patch)]) : null};
        }
        setOrdinal.run(ordinal, id);
        yield {projection, keys: semantics.buildRowKeys(projection), canonicalOrdinal: ordinal++,
          detailLocator: {version: 1, file: OUTPUTS.details, id, sha256: saved.full_sha256},
          frozenPrice: {totalRub: projection.totalRub ?? null, ledgerSha256: baseLedger}, cityPrices};
      }
    };
    db.exec('BEGIN');
    const queryIndex = await buildChinaQueryIndex({filename: paths.query, binding, rows: rows(), expectedRows: counts.admittedRows,
      cityKeys, assertAuthority: checkInputs});
    db.exec('COMMIT; DROP TABLE source_seen; DROP TABLE ordering;');
    need(db.prepare('SELECT COUNT(*) n FROM offers WHERE canonical_ordinal IS NULL').get().n === 0 &&
      db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 'details_integrity');
    db.close(); closed = true;
    await checkInputs(); await verifyContext(context); verifyFx(fxBatch, context);
    const reconciliation = {version: 1, kind: 'china-frozen-pricing-reconciliation-v1', market: 'china', generationId,
      sourceObservedAt: source.manifest.sourceObservedAt, supplierLatestVerified: source.manifest.supplierLatestVerified === true,
      pricingAsOf: fxBatch.receipt.pricingAsOf, ...counts, cityCount: cityKeys.length, cityLedgerRows: counts.admittedRows,
      cityPriceRows: counts.admittedRows * cityKeys.length,
      allInputRowsAccountedFor: true, priorPricesReused: false, missingValuesInvented: false,
      orderedInputRowsSha256: sourceRowsHash.digest('hex'), preparedDetailsSha256: detailsHash.digest('hex'),
      preparedCityLedgersSha256: citiesHash.digest('hex'), published: false, sourceApiCalls: 0, remoteStorageWrites: 0,
      localOnlyPricing: true, encyclopediaWritten: false, otherMarketsWritten: false};
    const reconciliationFile = await writeJson(paths.reconciliation, reconciliation);
    const detailsFile = await sealFile(paths.details), dispositionFile = await sealFile(paths.dispositions);
    const manifest = {version: 1, kind: 'china-local-generation-v1', market: 'china', generationId, runtimeSha: context.receipt.runtimeSha,
      queryIndex, files: {details: detailsFile, semantics: semanticFile, fx: fxFile, dispositions: dispositionFile, reconciliation: reconciliationFile},
      filterSemanticsSha256: semantics.receiptSha256, source: {manifestSha256: sourceSeal, cursor: source.manifest.source.cursor,
        sourceObservedAt: source.manifest.sourceObservedAt, supplierLatestVerified: source.manifest.supplierLatestVerified === true},
      contextReceiptSha256: contextSeal, pricingReceiptSha256: fxBatch.receiptSha256,
      calculationVersion: context.receipt.calculationVersion, pricingAsOf: fxBatch.receipt.pricingAsOf,
      rows: counts.admittedRows, sourceRows: counts.sourceRows, cityKeys, reconciliation,
      canonicalOrder: 'runtime-display-price-power-freshness-id-v1', cityLedgerFormat: 'ready-patch-with-lines-v1', cityLedgerCodec: 'gzip-city-map-v1',
      maxCityMapJsonBytes: counts.maxCityMapJsonBytes,
      prepared: true, published: false, activationAuthorized: false};
    for (const filename of [paths.details, paths.semantics, paths.fx, paths.dispositions, paths.reconciliation]) await fs.chmod(filename, 0o400);
    // This completion marker is written last. A failed source, price or index
    // leaves no generation that the serving reader can accept.
    const manifestFile = await writeJson(paths.manifest, manifest); await fs.chmod(paths.manifest, 0o400);
    completed = true;
    await onProgress({phase: 'china_frozen_generation_prepared', sourceRows: counts.sourceRows, rows: counts.admittedRows,
      pricedRows: counts.pricedRows, sellerOnlyRows: counts.sellerOnlyRows, unpricedRows: counts.unpricedRows,
      manifestSha256: manifestFile.sha256});
    return {manifest, manifestSha256: manifestFile.sha256, manifestPath: paths.manifest, reconciliation, paths, files: manifest.files,
      queryIndex, sourceManifestSha256: sourceSeal, contextReceiptSha256: contextSeal, pricingReceiptSha256: fxBatch.receiptSha256};
  } finally {
    if (!closed) db.close();
    if (!ledgerClosed) await dispositions.close().catch(() => {});
    if (!completed) await fs.writeFile(path.join(outputDirectory, 'INCOMPLETE.json'), JSON.stringify({version: 1, market: 'china',
      generationId, complete: false, published: false, sourceRows: counts.sourceRows, admittedRows: counts.admittedRows}),
    {flag: 'wx', mode: 0o600}).catch(() => {});
  }
}
