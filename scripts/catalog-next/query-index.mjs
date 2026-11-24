import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {createReadStream, statSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {calculatedCatalogPrice} from '../../apps/web/lib/catalog/calculated-price.ts';

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{24}$/;
const need = (value, reason) => assert(value, 'china_query_' + reason);
const hash = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => hash(JSON.stringify(value));
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && value.length <= 4096 && !/[\x00-\x1f]/.test(value);
const dimensions = ['make', 'color', 'fuel', 'bodyType', 'transmission', 'drive', 'auctionGrade'];
const columns = {make: 'make_key', color: 'color_key', fuel: 'fuel_key', bodyType: 'body_key',
  transmission: 'transmission_key', drive: 'drive_key', auctionGrade: 'grade_key'};
const bindingFields = ['sourceSha256', 'pricingReceiptSha256', 'calculationVersion', 'encyclopediaSha256', 'editorialSha256', 'deliveryTariffSha256', 'filterSemanticsSha256'];
const PRICE_SEMANTICS = 'calculatedCatalogPrice-seller-fallback-v1';
const LAYOUT = 'filter-columns-with-separate-payloads-v1';
const HYDRATE_SQL = 'SELECT projection_json,locator_json FROM card_payloads WHERE id=?';

function validateBinding(binding) {
  need(binding?.version === 1 && binding.market === 'china' && typeof binding.generationId === 'string' &&
    /^gen_[a-zA-Z0-9_-]{1,180}$/.test(binding.generationId) && bindingFields.every(name => SHA.test(binding[name] ?? '')) &&
    integer(binding.sourceCursor) && typeof binding.sourceObservedAt === 'string' && Number.isFinite(Date.parse(binding.sourceObservedAt)) &&
    typeof binding.pricingAsOf === 'string' && Number.isFinite(Date.parse(binding.pricingAsOf)), 'binding');
}

async function fileHash(filename) {
  const stat = await fs.lstat(filename);
  need(stat.isFile() && !stat.isSymbolicLink(), 'file_type');
  const digest = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(filename)) { digest.update(chunk); bytes += chunk.length; }
  const after = await fs.lstat(filename);
  need(bytes === stat.size && after.ino === stat.ino && after.dev === stat.dev && after.size === stat.size &&
    after.mtimeMs === stat.mtimeMs, 'file_changed');
  return {bytes, sha256: digest.digest('hex'), ino: stat.ino, dev: stat.dev, mtimeMs: stat.mtimeMs};
}

function price(value) {
  need(value && (value.totalRub === null || Number.isSafeInteger(value.totalRub) && value.totalRub > 0) &&
    (value.totalRub === null ? value.ledgerSha256 === null : SHA.test(value.ledgerSha256 ?? '')), 'frozen_price');
  return value.totalRub;
}

/** rows supplies already frozen projections and semantic keys from the exact
 * runtime/encyclopedia context. No alias, quote, power or price is guessed here.
 * canonicalOrdinal is the accepted full-generation order, not a SQL rowid.
 * This function only creates a NEW local file; no storage/network API exists. */
export async function buildChinaQueryIndex({filename, binding, rows, expectedRows, cityKeys = [], assertAuthority = () => {}}) {
  validateBinding(binding);
  need(path.isAbsolute(filename) && integer(expectedRows) && expectedRows > 0 && Array.isArray(cityKeys) &&
    cityKeys.every(value => text(value) && value.length > 0) && new Set(cityKeys).size === cityKeys.length, 'configuration');
  await assertAuthority();
  const reservation = await fs.open(filename, 'wx', 0o600); await reservation.close();
  const db = new DatabaseSync(filename, {allowExtension: false});
  let count = 0, closed = false;
  const rowsHash = createHash('sha256').update('china-query-index-rows-v1\n');
  const priceHash = createHash('sha256').update('china-query-index-prices-v1\n');
  try {
    db.exec(`PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA temp_store=FILE;
      CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE cards(id TEXT PRIMARY KEY, canonical_ordinal INTEGER NOT NULL UNIQUE,
        make_key TEXT NOT NULL,color_key TEXT NOT NULL,fuel_key TEXT NOT NULL,body_key TEXT NOT NULL,
        transmission_key TEXT NOT NULL,drive_key TEXT NOT NULL,grade_key TEXT NOT NULL,
        year REAL,mileage_filter REAL,mileage_sort REAL,engine_cc REAL,filter_power_hp REAL,
        auction_time REAL,auction_date TEXT,filter_rub INTEGER,seller_price_rub REAL);
      CREATE TABLE card_payloads(id TEXT PRIMARY KEY,projection_json TEXT NOT NULL,
        locator_json TEXT NOT NULL,price_ledger_sha256 TEXT) WITHOUT ROWID;
      CREATE TABLE model_terms(term TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(term,id));
      CREATE TABLE city_prices(city TEXT NOT NULL,id TEXT NOT NULL,filter_rub INTEGER,
        ledger_sha256 TEXT,PRIMARY KEY(city,id));
      BEGIN;`);
    const put = db.prepare('INSERT INTO cards VALUES(' + Array.from({length: 18}, () => '?').join(',') + ')');
    const payloads = db.prepare('INSERT INTO card_payloads VALUES(?,?,?,?)');
    const model = db.prepare('INSERT INTO model_terms VALUES(?,?)');
    const city = db.prepare('INSERT INTO city_prices VALUES(?,?,?,?)');
    for await (const row of rows) {
      const projection = row?.projection, keys = row?.keys;
      need(projection?.market === 'china' && ID.test(projection.id ?? '') && row.canonicalOrdinal === count &&
        keys && dimensions.every(name => text(keys[name])) && Array.isArray(keys.modelTerms) &&
        keys.modelTerms.every(value => text(value) && value.length > 0) && new Set(keys.modelTerms).size === keys.modelTerms.length &&
        (keys.filterPowerHp === null || typeof keys.filterPowerHp === 'number' && Number.isFinite(keys.filterPowerHp) && keys.filterPowerHp > 0),
      'row_identity');
      need(row.detailLocator && typeof row.detailLocator === 'object' && !Array.isArray(row.detailLocator), 'detail_locator');
      const rub = price(row.frozenPrice);
      need((projection.totalRub ?? null) === rub, 'projection_price_disagrees');
      // A displayed numeric total is not necessarily an automatic delivered
      // quote. Reuse the exact runtime's pure rule ONCE at offline preparation:
      // seller-only and unresolved modification rows do not match budgets.
      const filterRub = positive(calculatedCatalogPrice(projection));
      need(filterRub === null || filterRub === rub, 'frozen_filter_price_disagrees');
      const cities = row.cityPrices ?? {};
      need(Object.keys(cities).sort().join('\n') === [...cityKeys].sort().join('\n'), 'city_price_coverage');
      const payload = JSON.stringify(projection), locator = JSON.stringify(row.detailLocator);
      need(Buffer.byteLength(payload) <= 1024 * 1024 && Buffer.byteLength(locator) <= 8192, 'single_record_size');
      put.run(projection.id, count, keys.make, keys.color, keys.fuel, keys.bodyType, keys.transmission, keys.drive, keys.auctionGrade,
        positive(projection.year), positive(projection.mileageKm), nonnegative(projection.mileageKm), positive(projection.engineCc), keys.filterPowerHp,
        positive(Date.parse(projection.auctionDate ?? '')), typeof projection.auctionDate === 'string' ? projection.auctionDate : null,
        filterRub, positive(projection.sellerPriceRub));
      payloads.run(projection.id, payload, locator, row.frozenPrice.ledgerSha256);
      for (const term of keys.modelTerms) model.run(term, projection.id);
      for (const key of cityKeys) {
        const cityRub = price(cities[key]);
        need(filterRub === null || cityRub !== null, 'city_filter_price_missing');
        city.run(key, projection.id, filterRub === null ? null : cityRub, cities[key].ledgerSha256);
      }
      rowsHash.update(JSON.stringify([projection.id, count, jsonHash(projection), jsonHash(keys), jsonHash(row.detailLocator)]) + '\n');
      priceHash.update(JSON.stringify([projection.id, row.frozenPrice, cities]) + '\n');
      count++;
      if (count % 1000 === 0) { db.exec('COMMIT; BEGIN;'); await assertAuthority(); }
    }
    need(count === expectedRows, 'row_count');
    db.exec(`COMMIT;
      CREATE INDEX cards_price ON cards(filter_rub,id);
      CREATE INDEX cards_power ON cards(filter_power_hp,id);
      CREATE INDEX cards_make ON cards(make_key,canonical_ordinal);
      CREATE INDEX cards_year ON cards(year,id);
      CREATE INDEX cards_mileage ON cards(mileage_filter,id);
      CREATE INDEX cards_engine ON cards(engine_cc,id);
      CREATE INDEX city_prices_price ON city_prices(city,filter_rub,id);
      ANALYZE;`);
    const metadata = {version: 1, kind: 'china-query-index-v1', layout: LAYOUT, priceSemantics: PRICE_SEMANTICS, binding, rows: count, cityKeys: [...cityKeys],
      orderedRowsSha256: rowsHash.digest('hex'), frozenPricesSha256: priceHash.digest('hex')};
    db.prepare('INSERT INTO metadata VALUES(?,?)').run('manifest', JSON.stringify(metadata));
    need(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 'integrity');
    db.close(); closed = true;
    await assertAuthority();
    await fs.chmod(filename, 0o400);
    const {bytes, sha256} = await fileHash(filename);
    return {...metadata, file: {name: path.basename(filename), bytes, sha256}};
  } catch (error) {
    // No completed manifest is returned; callers cannot activate this file.
    throw error;
  } finally { if (!closed) db.close(); }
}

function compileQuery(params, manifest) {
  const allowed = new Set([...dimensions.map(name => name + 'Keys'), 'modelTerms', 'hasPrice', 'budgetFrom', 'budgetTo',
    'yearFrom', 'yearTo', 'mileageFrom', 'mileageTo', 'engineFrom', 'engineTo', 'powerFrom', 'powerTo',
    'auctionDateFrom', 'auctionDateTo', 'cityKey', 'sort', 'page', 'pageSize', 'countOnly']);
  need(params && typeof params === 'object' && Object.keys(params).every(key => allowed.has(key)), 'unsupported_filter');
  need(params.countOnly === undefined || typeof params.countOnly === 'boolean', 'count_only');
  const filters = [], values = [];
  const clause = (sql, ...args) => { filters.push(sql); values.push(...args); };
  for (const dimension of dimensions) {
    const selected = params[dimension + 'Keys'];
    if (selected === undefined) continue;
    need(Array.isArray(selected) && selected.length > 0 && selected.length <= 1000 && selected.every(text), 'selection');
    clause(`c.${columns[dimension]} IN (${selected.map(() => '?').join(',')})`, ...selected);
  }
  if (params.modelTerms !== undefined) {
    need(Array.isArray(params.modelTerms) && params.modelTerms.length > 0 && params.modelTerms.length <= 1000 && params.modelTerms.every(text), 'model_selection');
    clause(`c.id IN (SELECT id FROM model_terms WHERE term IN (${params.modelTerms.map(() => '?').join(',')}))`, ...params.modelTerms);
  }
  const cityKey = params.cityKey;
  need(cityKey === undefined || manifest.cityKeys.includes(cityKey), 'city_not_prepared');
  const rub = cityKey === undefined ? 'c.filter_rub' : 'p.filter_rub';
  const numeric = (name, sql, adjustment = 0) => {
    if (params[name] === undefined || params[name] === 0) return;
    need(typeof params[name] === 'number' && Number.isFinite(params[name]) && params[name] >= 0, 'numeric_filter');
    clause(sql, params[name] + adjustment);
  };
  if (params.hasPrice !== undefined) {
    need(['yes', 'no'].includes(params.hasPrice), 'has_price');
    clause(`${rub} IS ${params.hasPrice === 'yes' ? 'NOT ' : ''}NULL`);
  }
  numeric('budgetFrom', `${rub}>=?`); numeric('budgetTo', `${rub}<=?`);
  // Unknown years retain the existing zero-value upper-bound semantics, while
  // a positive lower bound can use the year index directly.
  numeric('yearFrom', 'c.year>=?'); numeric('yearTo', '(c.year<=? OR c.year IS NULL)');
  numeric('mileageFrom', 'c.mileage_filter>=?'); numeric('mileageTo', 'c.mileage_filter<=?');
  numeric('engineFrom', 'c.engine_cc>=?'); numeric('engineTo', 'c.engine_cc<=?');
  numeric('powerFrom', 'c.filter_power_hp>=?'); numeric('powerTo', 'c.filter_power_hp<=?', 0.01);
  for (const name of ['auctionDateFrom', 'auctionDateTo']) if (params[name] !== undefined) {
    need(typeof params[name] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params[name]), 'auction_date');
    clause(`c.auction_date${name.endsWith('From') ? '>=' : '<='}?`, params[name]);
  }
  const terms = params.sort === undefined || params.sort === 'updatedAt' ? [] : String(params.sort).split(',');
  const orders = {totalRub: [rub, 'ASC', 'price'], totalRubDesc: [rub, 'DESC', 'price'], year: ['c.year', 'DESC', 'year'],
    yearAsc: ['c.year', 'ASC', 'year'], mileage: ['c.mileage_sort', 'ASC', 'mileage'], mileageDesc: ['c.mileage_sort', 'DESC', 'mileage'],
    auctionDateAsc: ['c.auction_time', 'ASC', 'auction'], auctionDateDesc: ['c.auction_time', 'DESC', 'auction']};
  need(terms.length <= 4 && terms.every(term => Object.hasOwn(orders, term)) &&
    new Set(terms.map(term => orders[term][2])).size === terms.length, 'sort');
  const order = terms.length ? terms.map(term => {
    const [column, direction, field] = orders[term];
    const primary = `(${column} IS NULL) ASC,${column} ${direction}`;
    // The existing comparator considers seller prices only when BOTH delivered
    // totals are absent, before moving to the next requested sort term.
    const seller = `CASE WHEN ${column} IS NULL THEN c.seller_price_rub END`;
    return primary + (field === 'price' ? `,(${seller} IS NULL) ASC,${seller} ${direction}` : '');
  }).join(',') + ',c.id COLLATE BINARY' : 'c.canonical_ordinal';
  const page = params.page ?? 1, pageSize = params.pageSize ?? 24;
  need(Number.isSafeInteger(page) && page > 0 && Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 48 &&
    Number.isSafeInteger(page * pageSize), 'pagination');
  const from = 'cards c' + (cityKey === undefined ? '' : ' JOIN city_prices p ON p.id=c.id AND p.city=?');
  const bound = cityKey === undefined ? values : [cityKey, ...values];
  const where = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
  return {values: bound, page, pageSize, offset: (page - 1) * pageSize,
    countSql: 'SELECT COUNT(*) n FROM ' + from + where,
    selectSql: 'SELECT c.id,' + rub + ' query_rub FROM ' + from + where + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?'};
}

/** Opening performs the full local hash/integrity check BEFORE serving. Query
 * calls run only SQLite SELECTs plus an in-memory authority callback; they do
 * not download a generation, fetch FX or rebuild any index. */
export async function openChinaQueryIndex({filename, manifest, assertAuthority = () => {}}) {
  manifest = structuredClone(manifest);
  validateBinding(manifest?.binding);
  need(manifest.version === 1 && manifest.kind === 'china-query-index-v1' && manifest.layout === LAYOUT &&
    manifest.priceSemantics === PRICE_SEMANTICS && integer(manifest.rows) && manifest.rows > 0 &&
    manifest.file?.name === path.basename(filename) && SHA.test(manifest.file?.sha256 ?? ''), 'manifest');
  need(assertAuthority.constructor?.name !== 'AsyncFunction', 'async_request_authority');
  const authority = () => need(assertAuthority()?.then === undefined, 'async_request_authority');
  authority();
  const actual = await fileHash(filename);
  need(actual.sha256 === manifest.file.sha256 && actual.bytes === manifest.file.bytes, 'file_checksum');
  const db = new DatabaseSync(filename, {readOnly: true, allowExtension: false});
  let closed = false;
  try {
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
    const {file, ...expected} = manifest;
    const sealed = JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='manifest'").get()?.value ?? 'null');
    need(jsonHash(sealed) === jsonHash(expected) && db.prepare('PRAGMA quick_check').get().quick_check === 'ok' &&
      db.prepare('SELECT COUNT(*) n FROM cards').get().n === manifest.rows &&
      db.prepare('SELECT COUNT(*) n FROM card_payloads').get().n === manifest.rows, 'metadata');
    authority();
  } catch (error) { db.close(); throw error; }
  const localIdentity = () => {
    const current = statSync(filename);
    need(current.ino === actual.ino && current.dev === actual.dev && current.size === actual.bytes &&
      current.mtimeMs === actual.mtimeMs, 'open_file_changed');
  };
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  freeze(manifest);
  const hydrate = db.prepare(HYDRATE_SQL);
  return Object.freeze({
    manifest,
    query(params = {}) {
      need(!closed, 'reader_closed');
      // A network-backed callback here would put storage on the visitor path;
      // asynchronous callbacks are explicitly refused.
      authority(); localIdentity();
      const sql = compileQuery(params, manifest);
      const total = Number(db.prepare(sql.countSql).get(...sql.values).n);
      // Filtering/sorting handles only compact scalar columns. JSON is read
      // in a separate point lookup AFTER LIMIT, never by the sorting cursor.
      const selected = params.countOnly ? [] : db.prepare(sql.selectSql).all(...sql.values, sql.pageSize, sql.offset);
      const items = selected.map(row => {
        const payload = hydrate.get(row.id);
        need(payload, 'payload_missing');
        return {id: row.id, projection: JSON.parse(payload.projection_json),
          detailLocator: JSON.parse(payload.locator_json), queryRub: row.query_rub};
      });
      authority(); localIdentity();
      return {generationId: manifest.binding.generationId, total, page: sql.page, pageSize: sql.pageSize, items};
    },
    /** Operator/test inspection of the exact statements used above. No vehicle
     * payload is read or exposed by EXPLAIN. This is not a public route. */
    explainQuery(params = {}) {
      need(!closed, 'reader_closed'); authority(); localIdentity();
      const sql = compileQuery(params, manifest);
      const explain = (statement, values) => ({sql: statement,
        plan: db.prepare('EXPLAIN QUERY PLAN ' + statement).all(...values),
        bytecode: db.prepare('EXPLAIN ' + statement).all(...values)});
      const result = {count: explain(sql.countSql, sql.values),
        selection: params.countOnly ? null : explain(sql.selectSql, [...sql.values, sql.pageSize, sql.offset]),
        hydration: params.countOnly ? null : explain(HYDRATE_SQL, ['0'.repeat(24)])};
      authority(); localIdentity(); return result;
    },
    close() { if (!closed) { db.close(); closed = true; } },
  });
}
