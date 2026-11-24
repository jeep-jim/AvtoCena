import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {collectAutoApiChe168} from '../lib/auto-api-che168-client.mjs';
import {normalizeAutoApiChe168, autoApiChe168RejectionReason, isAutoApiChe168QuarantineReason}
  from '../../apps/web/lib/catalog/auto-api-che168.ts';

const SOURCE = 'autohome_used_china_open', HASH = /^[a-f0-9]{64}$/, ID = /^\d{1,32}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const need = (value, code) => assert(value, 'china_refresh_' + code);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalizedSql = sql => String(sql).replace(/\s+/g, '').toLowerCase();
const schema = Object.freeze({
  offers: `CREATE TABLE offers(id TEXT PRIMARY KEY, source_offer_id TEXT NOT NULL UNIQUE, year INTEGER,
    eligible INTEGER NOT NULL, disposition TEXT NOT NULL, payload TEXT NOT NULL, payload_sha256 TEXT NOT NULL)`,
  base_ids: 'CREATE TABLE base_ids(id TEXT PRIMARY KEY, source_offer_id TEXT NOT NULL UNIQUE, payload_sha256 TEXT NOT NULL)',
  change_pages: `CREATE TABLE change_pages(sequence INTEGER PRIMARY KEY, requested_cursor INTEGER NOT NULL,
    next_cursor INTEGER, observed_at TEXT NOT NULL, payload TEXT NOT NULL, payload_sha256 TEXT NOT NULL)`,
  change_events: `CREATE TABLE change_events(event_id INTEGER PRIMARY KEY, source_offer_id TEXT NOT NULL,
    change_type TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL, payload_sha256 TEXT NOT NULL)`,
  applied_events: 'CREATE TABLE applied_events(event_id INTEGER PRIMARY KEY, kind TEXT NOT NULL)',
  states: 'CREATE TABLE states(source_offer_id TEXT PRIMARY KEY, event INTEGER NOT NULL, state TEXT NOT NULL, at TEXT NOT NULL, reason TEXT)',
  pending_details: 'CREATE TABLE pending_details(source_offer_id TEXT PRIMARY KEY, event INTEGER NOT NULL, at TEXT NOT NULL)',
  offers_eligible_year: 'CREATE INDEX offers_eligible_year ON offers(eligible,year,id)',
});
const stableId = sourceOfferId => hash(SOURCE + ':' + sourceOfferId).slice(0, 24);
const safeError = error => /^(?:china_refresh_[a-z0-9_]+|auto_api_http_\d{3}|auto_api_(?:time_budget|transport_failed|invalid_json|invalid_changes|stalled_changes|detail_identity_mismatch|detail_404_unresolved))$/.test(error?.message ?? '')
  ? error : Error('china_refresh_failed');
function parse(value) { try { return JSON.parse(value); } catch { throw Error('china_refresh_invalid_json'); } }
function freeze(value) {
  if (object(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function rowIdentity(offer) {
  need(object(offer) && offer.market === 'china' && offer.sourceId === SOURCE && offer.status === 'active' &&
    typeof offer.sourceOfferId === 'string' && ID.test(offer.sourceOfferId) && offer.id === stableId(offer.sourceOfferId) &&
    offer.operational?.provider === 'auto-api.com' && offer.operational.detailIdentityVerified === true, 'offer_identity');
}
function classification(offer, observedAt) {
  const year = Number.isSafeInteger(offer.year) && offer.year >= 1886 &&
    offer.year <= new Date(observedAt).getUTCFullYear() + 1 ? offer.year : null;
  const disposition = year === null ? 'year_unknown' : year < 2014 ? 'year_before_minimum' : 'eligible';
  return {year, eligible: disposition === 'eligible' ? 1 : 0, disposition};
}

/** Call with the raw existing collection-controls object. Only China's saved
 * market/source switches are relevant; unrelated malformed flags do not block
 * this reader. Missing/corrupt settings never enable supplier access. */
export function assertChinaFeedControl(value) {
  need(object(value) && value.version === 1 && integer(value.revision) &&
    typeof value.markets?.china?.enabled === 'boolean' && typeof value.sources?.che168_feed?.enabled === 'boolean', 'control_invalid');
  need(value.markets.china.enabled && value.sources.che168_feed.enabled, 'control_disabled');
  return {revision: value.revision, market: 'china', sourceId: 'che168_feed', enabled: true};
}

function changePage(payload, cursor) {
  need(object(payload) && Array.isArray(payload.result) && object(payload.meta) && payload.meta.cur_change_id === cursor, 'changes_identity');
  if (!payload.result.length) {
    need(payload.meta.next_change_id == null || payload.meta.next_change_id === cursor, 'empty_page_gap');
    return null;
  }
  const next = payload.meta.next_change_id;
  need(integer(next) && next > cursor, 'changes_cursor');
  for (const row of payload.result) need(object(row) && integer(row.id) && row.id >= cursor && row.id <= next &&
    ID.test(String(row.inner_id)) && ['added', 'changed', 'removed'].includes(row.change_type) && instant(row.created_at), 'change_event');
  return next;
}
const eventPayload = row => ({id: row.id, inner_id: String(row.inner_id), change_type: row.change_type,
  created_at: row.created_at, ...(row.data === undefined ? {} : {data: row.data})});

async function hashFile(filename) {
  const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    need(before.isFile() && before.nlink === 1, 'file_type');
    const sum = createHash('sha256'); let bytes = 0;
    for await (const chunk of file.createReadStream({autoClose: false})) { sum.update(chunk); bytes += chunk.length; }
    const after = await file.stat(), named = await fs.lstat(filename);
    need(sameStat(before, after) && sameStat(before, named) && !named.isSymbolicLink() && bytes === before.size, 'file_changed');
    return {bytes, sha256: sum.digest('hex'), stat: after};
  } finally { await file.close(); }
}
const sameStat = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
function checkedRow(row, manifest) {
  need(typeof row.payload === 'string' && HASH.test(row.payload_sha256 ?? '') && hash(row.payload) === row.payload_sha256, 'row_checksum');
  const offer = parse(row.payload); rowIdentity(offer);
  const policy = classification(offer, manifest.sourceObservedAt), active = offer.operational.che168ActiveVerification;
  need(row.id === offer.id && row.source_offer_id === offer.sourceOfferId && row.year === policy.year &&
    row.eligible === policy.eligible && row.disposition === policy.disposition &&
    active?.method === 'snapshot_and_complete_change_stream' && active.cursor === manifest.source.cursor &&
    active.snapshotBinding === manifest.source.snapshotBinding && active.verifiedAt === manifest.sourceObservedAt &&
    active.baseSourceReceiptSha256 === manifest.lineage.inputPrivateReceiptSha256, 'row_binding');
  return offer;
}
function census(db, manifest) {
  const counts = {sourceRows: 0, eligible: 0, yearBeforeMinimum: 0, yearUnknown: 0, missingPrice: 0, missingPower: 0};
  const ids = createHash('sha256').update('['), rows = createHash('sha256').update('[');
  for (const row of db.prepare('SELECT * FROM offers ORDER BY id COLLATE BINARY').iterate()) {
    const offer = checkedRow(row, manifest);
    if (counts.sourceRows++) { ids.update(','); rows.update(','); }
    ids.update(JSON.stringify(row.id)); rows.update(JSON.stringify([row.id, row.payload_sha256]));
    if (row.eligible) counts.eligible++; else if (row.year === null) counts.yearUnknown++; else counts.yearBeforeMinimum++;
    if (!(Number.isFinite(offer.sourcePrice) && offer.sourcePrice > 0)) counts.missingPrice++;
    if (!(Number.isFinite(offer.powerHp) && offer.powerHp > 0)) counts.missingPower++;
  }
  return {...counts, idsSha256: ids.update(']').digest('hex'), rowsSha256: rows.update(']').digest('hex')};
}
function deltaCounts(db) {
  const count = sql => db.prepare(sql).get().n;
  return {
    baseSourceRows: count('SELECT COUNT(*) n FROM base_ids'),
    insertedRows: count('SELECT COUNT(*) n FROM offers o LEFT JOIN base_ids b ON b.id=o.id WHERE b.id IS NULL'),
    updatedRows: count('SELECT COUNT(*) n FROM offers o JOIN base_ids b ON b.id=o.id JOIN states s ON s.source_offer_id=o.source_offer_id'),
    unchangedRows: count('SELECT COUNT(*) n FROM offers o JOIN base_ids b ON b.id=o.id LEFT JOIN states s ON s.source_offer_id=o.source_offer_id WHERE s.source_offer_id IS NULL'),
    removedRows: count("SELECT COUNT(*) n FROM base_ids b LEFT JOIN offers o ON o.id=b.id JOIN states s ON s.source_offer_id=b.source_offer_id WHERE o.id IS NULL AND s.state='removed'"),
    quarantinedRows: count("SELECT COUNT(*) n FROM base_ids b LEFT JOIN offers o ON o.id=b.id JOIN states s ON s.source_offer_id=b.source_offer_id WHERE o.id IS NULL AND s.state='quarantine'"),
    removedOutsideBase: count("SELECT COUNT(*) n FROM states s LEFT JOIN base_ids b ON b.source_offer_id=s.source_offer_id WHERE b.id IS NULL AND s.state='removed'"),
    quarantinedOutsideBase: count("SELECT COUNT(*) n FROM states s LEFT JOIN base_ids b ON b.source_offer_id=s.source_offer_id WHERE b.id IS NULL AND s.state='quarantine'"),
    unresolvedDetails: count('SELECT COUNT(*) n FROM pending_details'),
  };
}
function journalSummary(db, initialCursor) {
  const sum = createHash('sha256').update('['); let pages = 0, rawEvents = 0, cursor = initialCursor, terminal = null;
  const event = db.prepare('SELECT * FROM change_events WHERE event_id=?');
  for (const row of db.prepare('SELECT * FROM change_pages ORDER BY sequence').iterate()) {
    need(terminal === null && row.sequence === pages && row.requested_cursor === cursor &&
      instant(row.observed_at) && hash(row.payload) === row.payload_sha256, 'page_chain');
    const value = parse(row.payload), next = changePage(value, cursor);
    need(next === row.next_cursor, 'page_chain');
    for (const raw of value.result) {
      const expected = eventPayload(raw), stored = event.get(raw.id);
      need(stored && stored.payload_sha256 === digest(expected) && hash(stored.payload) === stored.payload_sha256 &&
        stored.source_offer_id === expected.inner_id && stored.change_type === expected.change_type && stored.created_at === expected.created_at, 'event_evidence');
    }
    if (pages++) sum.update(',');
    sum.update(JSON.stringify([row.sequence, row.requested_cursor, row.next_cursor, row.observed_at, row.payload_sha256]));
    rawEvents += value.result.length;
    if (next === null) terminal = {cursor, observedAt: row.observed_at}; else cursor = next;
  }
  need(terminal && pages > 0, 'terminal_missing');
  const uniqueEvents = db.prepare('SELECT COUNT(*) n FROM change_events').get().n;
  const applied = db.prepare('SELECT COUNT(*) n FROM applied_events').get().n;
  need(uniqueEvents === applied && uniqueEvents <= rawEvents &&
    db.prepare('SELECT COUNT(*) n FROM applied_events a LEFT JOIN change_events e ON e.event_id=a.event_id WHERE e.event_id IS NULL').get().n === 0,
    'events_incomplete');
  return {pages, rawEvents, uniqueEvents, duplicateEvents: rawEvents - uniqueEvents,
    pagesSha256: sum.update(']').digest('hex'), terminalCursor: terminal.cursor, terminalObservedAt: terminal.observedAt};
}

/** No storage capability, shared cursor, publisher or supplier credential is
 * accepted here. The caller provides the existing Auto API client and a fresh
 * China-only owner-switch check. Output is a private immutable full source;
 * preliminary year counters never filter offers() or replace final admission. */
export async function refreshChinaSource({source, outputDirectory, client, checkControl, onProgress = () => {}, now = () => new Date().toISOString()}) {
  need(source?.complete === true && typeof source.offers === 'function' && source.manifest?.market === 'china' &&
    source.manifest.sourceId === SOURCE && integer(source.manifest.source?.cursor) &&
    HASH.test(source.manifest.source.snapshotBinding ?? '') && instant(source.manifest.sourceObservedAt) &&
    integer(source.reconciliation?.sourceRows) && source.reconciliation.sourceRows > 0 &&
    typeof client === 'function' && typeof checkControl === 'function', 'arguments');
  const baseManifestSha256 = digest(source.manifest);
  const inputPrivateReceiptSha256 = source.receiptSha256 ?? source.lineage?.inputPrivateReceiptSha256;
  need(HASH.test(inputPrivateReceiptSha256 ?? ''), 'base_receipt');
  if (source.manifest.kind === 'china-saved-source-v1')
    need(source.receipt?.sourceManifestSha256 === baseManifestSha256, 'base_manifest');
  else need(source.manifest.kind === 'china-refreshed-source-v1' && HASH.test(source.descriptorSha256 ?? ''), 'base_manifest');
  need(typeof outputDirectory === 'string' && path.isAbsolute(outputDirectory) && path.resolve(outputDirectory) === outputDirectory &&
    outputDirectory !== path.parse(outputDirectory).root && await fs.realpath(path.dirname(outputDirectory)) === path.dirname(outputDirectory), 'output_directory');
  const check = async () => { try { need(await checkControl() !== false, 'control_disabled'); } catch (error) {
    throw /^china_refresh_control_/.test(error?.message ?? '') ? error : Error('china_refresh_control_refused');
  }};
  await check();
  await fs.mkdir(outputDirectory, {mode: 0o700});
  const directoryIdentity = await fs.lstat(outputDirectory);
  const databasePath = path.join(outputDirectory, 'source.sqlite'), descriptorPath = path.join(outputDirectory, 'SOURCE.json');
  let db, complete = false, transaction = false;
  try {
    db = new DatabaseSync(databasePath, {allowExtension: false}); await fs.chmod(databasePath, 0o600);
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA cache_size=-16384; PRAGMA temp_store=FILE;');
    for (const sql of Object.values(schema)) db.exec(sql);
    const put = db.prepare('INSERT INTO offers VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET year=excluded.year,eligible=excluded.eligible,disposition=excluded.disposition,payload=excluded.payload,payload_sha256=excluded.payload_sha256');
    const putOffer = (offer, observedAt) => {
      rowIdentity(offer); const c = classification(offer, observedAt), payload = JSON.stringify(offer);
      put.run(offer.id, offer.sourceOfferId, c.year, c.eligible, c.disposition, payload, hash(payload));
    };
    const base = db.prepare('INSERT INTO base_ids VALUES(?,?,?)'); let baseRows = 0;
    db.exec('BEGIN'); transaction = true;
    for await (const offer of source.offers({eligibleOnly: false})) {
      rowIdentity(offer); base.run(offer.id, offer.sourceOfferId, digest(offer));
      putOffer(offer, source.manifest.sourceObservedAt); baseRows++;
      if (baseRows % 1000 === 0) { db.exec('COMMIT; BEGIN'); }
    }
    db.exec('COMMIT'); transaction = false;
    need(baseRows === source.reconciliation.sourceRows, 'base_census');
    need(digest(source.manifest) === baseManifestSha256, 'base_changed');
    const initialCursor = source.manifest.source.cursor;
    let nextRequestCursor = initialCursor, sequence = 0, terminalObservedAt = null, logicalDetailRequests = 0;
    const savedEvent = db.prepare('SELECT * FROM change_events WHERE event_id=?');
    const appliedEvent = db.prepare('SELECT kind FROM applied_events WHERE event_id=?');
    const current = db.prepare('SELECT payload FROM offers WHERE source_offer_id=?');
    const pending = db.prepare('SELECT event,at FROM pending_details WHERE source_offer_id=?');
    const state = db.prepare('SELECT event FROM states WHERE source_offer_id=?');
    const recordState = (change, kind, reason = null) => {
      const id = String(change.inner_id), before = state.get(id);
      need(!before || change.id > before.event, 'event_order');
      db.prepare('INSERT INTO states VALUES(?,?,?,?,?) ON CONFLICT(source_offer_id) DO UPDATE SET event=excluded.event,state=excluded.state,at=excluded.at,reason=excluded.reason')
        .run(id, change.id, kind, change.created_at, reason);
      const old = pending.get(id);
      if (old && change.id > old.event && Date.parse(change.created_at) >= Date.parse(old.at))
        db.prepare('DELETE FROM pending_details WHERE source_offer_id=?').run(id);
    };
    const mark = (change, kind) => {
      const saved = savedEvent.get(change.id);
      need(saved && saved.source_offer_id === String(change.inner_id) && saved.change_type === change.change_type && saved.created_at === change.created_at,
        'applied_event_identity');
      db.prepare('INSERT INTO applied_events VALUES(?,?)').run(change.id, kind);
    };
    const request = async (endpoint, params) => {
      need(endpoint === 'changes' || endpoint === 'offer', 'request_scope');
      if (endpoint === 'changes') need(params.change_id === nextRequestCursor && terminalObservedAt === null && !transaction, 'request_cursor');
      else { need(ID.test(String(params.inner_id)) && transaction, 'request_detail'); logicalDetailRequests++; }
      await check(); let payload;
      try { payload = await client(endpoint, params); } catch (error) { throw safeError(error); }
      if (endpoint === 'offer') return payload;
      const receivedAt = now(); need(instant(receivedAt) && Date.parse(receivedAt) >= Date.parse(source.manifest.sourceObservedAt), 'source_clock');
      const next = changePage(payload, params.change_id), serialized = JSON.stringify(payload);
      db.exec('BEGIN'); transaction = true;
      db.prepare('INSERT INTO change_pages VALUES(?,?,?,?,?,?)').run(sequence++, params.change_id, next, receivedAt, serialized, hash(serialized));
      for (const row of payload.result) {
        const value = eventPayload(row), body = JSON.stringify(value), existing = savedEvent.get(row.id);
        if (existing) need(existing.payload_sha256 === hash(body), 'conflicting_event');
        else db.prepare('INSERT INTO change_events VALUES(?,?,?,?,?,?)').run(row.id, value.inner_id, value.change_type, value.created_at, body, hash(body));
      }
      if (next === null) { terminalObservedAt = receivedAt; db.exec('COMMIT'); transaction = false; }
      else nextRequestCursor = next;
      return payload;
    };
    const completed = await collectAutoApiChe168({request, yearFrom: undefined,
      resume: {cursor: initialCursor, snapshotStartedAt: source.manifest.sourceObservedAt}, useChangeData: true, now,
      missingDetails: {
        record: async change => {
          if (appliedEvent.get(change.id)) return;
          db.prepare('INSERT INTO pending_details VALUES(?,?,?) ON CONFLICT(source_offer_id) DO UPDATE SET event=excluded.event,at=excluded.at WHERE excluded.event>pending_details.event')
            .run(String(change.inner_id), change.id, change.created_at); mark(change, 'missing_detail');
        },
        assertResolved: () => need(db.prepare('SELECT COUNT(*) n FROM pending_details').get().n === 0, 'detail_404_unresolved'),
      },
      onOffer: async (row, observedAt, change) => {
        if (appliedEvent.get(change.id)) return;
        let offer;
        try { offer = normalizeAutoApiChe168(row, observedAt); } catch { throw Error('china_refresh_normalization_failed'); }
        if (!offer) {
          const reason = autoApiChe168RejectionReason(row);
          need(isAutoApiChe168QuarantineReason(reason), 'identity_review_required');
          db.prepare('DELETE FROM offers WHERE source_offer_id=?').run(String(change.inner_id));
          recordState(change, 'quarantine', reason); mark(change, 'quarantine'); return;
        }
        need(offer.sourceOfferId === String(change.inner_id), 'detail_identity');
        const old = current.get(offer.sourceOfferId);
        if (old) offer.firstSeenAt = parse(old.payload).firstSeenAt;
        putOffer(offer, observedAt); recordState(change, 'offer'); mark(change, 'offer');
      },
      onRemoval: async change => {
        if (appliedEvent.get(change.id)) return;
        db.prepare('DELETE FROM offers WHERE source_offer_id=?').run(String(change.inner_id));
        recordState(change, 'removed'); mark(change, 'removed');
      },
      onPriceChange: async change => {
        if (appliedEvent.get(change.id)) return true;
        const price = Number(change.data.new_price); need(Number.isFinite(price) && price > 0, 'changed_price');
        // A price patch cannot attest the other attributes of an earlier
        // failed full-detail revision. Resolve it through a real detail read.
        if (pending.get(String(change.inner_id))) return false;
        const row = current.get(String(change.inner_id)); if (!row) return false;
        const offer = parse(row.payload); if (offer.sourceCurrency !== 'CNY') return false;
        const updated = {...offer, sourcePrice: price, totalRub: null, calculationStatus: 'needs_data', updatedAt: change.created_at,
          sellerPriceRub: undefined, previousTotalRub: null, priceDeltaRub: null, publicVisibleRub: undefined,
          calculationSnapshot: undefined, savedCalculationPreview: undefined, deliveredCalculationPreview: undefined,
          chinaPriceConversion: undefined, operational: {...offer.operational, lastSeenAt: change.created_at, che168PriceChangeId: change.id}};
        putOffer(updated, change.created_at); recordState(change, 'price'); mark(change, 'price'); return true;
      },
      onProgress: async progress => {
        need(transaction && progress.cursor === nextRequestCursor, 'page_commit');
        db.exec('COMMIT'); transaction = false;
        await onProgress({phase: 'china_source_delta', pages: sequence, changes: progress.changes, cursor: progress.cursor, logicalDetailRequests});
      },
    });
    need(!transaction && terminalObservedAt && completed.cursor === nextRequestCursor, 'stream_incomplete');
    await check();
    const journal = journalSummary(db, initialCursor);
    need(journal.rawEvents === completed.changes && journal.terminalCursor === completed.cursor && journal.terminalObservedAt === terminalObservedAt, 'stream_reconciliation');
    const lineage = {method: 'complete_changes_from_verified_private_source', inputPrivateReceiptSha256,
      baseSourceManifestSha256: baseManifestSha256, baseDescriptorSha256: source.descriptorSha256 ?? null,
      baseSourceObservedAt: source.manifest.sourceObservedAt, initialCursor, ...journal, logicalDetailRequests,
      transportAttempts: null, priorReportedQuarantined: source.reconciliation.sourceReportedQuarantined ?? source.reconciliation.priorReportedQuarantined ?? null};
    const manifest = {version: 1, kind: 'china-refreshed-source-v1', classification: 'private_source', market: 'china',
      provider: 'auto_api_che168', sourceId: SOURCE, sourceObservedAt: terminalObservedAt, supplierLatestVerified: true,
      source: {cursor: completed.cursor, snapshotBinding: source.manifest.source.snapshotBinding},
      policy: {minimumYear: 2014, finalAdmissionApplied: false}, lineage, publicationReady: false};
    // Bounded batches update activity proof only. Original detail dates remain
    // unchanged; a completed delta is distinct evidence of continued activity.
    const page = db.prepare('SELECT * FROM offers WHERE id>? ORDER BY id COLLATE BINARY LIMIT 256'); let lastId = '';
    while (true) {
      const rows = page.all(lastId); if (!rows.length) break;
      db.exec('BEGIN'); transaction = true;
      for (const row of rows) {
        const offer = parse(row.payload);
        offer.operational = {...offer.operational, lastSeenAt: terminalObservedAt,
          che168ActiveVerification: {method: 'snapshot_and_complete_change_stream', snapshotBinding: manifest.source.snapshotBinding,
            initialCursor, cursor: completed.cursor, verifiedAt: terminalObservedAt, baseSourceReceiptSha256: inputPrivateReceiptSha256}};
        putOffer(offer, terminalObservedAt); lastId = row.id;
      }
      db.exec('COMMIT'); transaction = false;
    }
    const counts = census(db, manifest), changes = deltaCounts(db);
    need(changes.unresolvedDetails === 0 && changes.baseSourceRows === baseRows &&
      counts.sourceRows === baseRows + changes.insertedRows - changes.removedRows - changes.quarantinedRows &&
      counts.sourceRows === changes.insertedRows + changes.updatedRows + changes.unchangedRows, 'final_census');
    const reconciliation = {version: 1, market: 'china', inputCoverage: 'verified_private_source_and_complete_delta',
      sourceObservedAt: terminalObservedAt, supplierLatestVerified: true, minimumYear: 2014, finalAdmissionApplied: false,
      ...counts, ...changes, priorReportedQuarantined: lineage.priorReportedQuarantined,
      allInputRowsAccountedFor: true, missingValuesInvented: false, pricesRecalculated: false, publicationReady: false};
    manifest.reconciliation = reconciliation;
    need(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 'database_integrity');
    db.close(); db = null;
    await check(); need(digest(source.manifest) === baseManifestSha256, 'base_changed');
    await fs.chmod(databasePath, 0o400); const file = await hashFile(databasePath);
    const descriptor = {version: 1, kind: 'china-refreshed-source-descriptor-v1', market: 'china',
      file: {name: 'source.sqlite', bytes: file.bytes, sha256: file.sha256}, manifest, reconciliation, lineage};
    const bytes = Buffer.from(JSON.stringify(descriptor));
    await fs.writeFile(descriptorPath, bytes, {flag: 'wx', mode: 0o400});
    need(hash(await fs.readFile(descriptorPath)) === hash(bytes), 'descriptor_readback');
    const output = await openLocalRefreshedChinaSource({descriptorPath, expectedSha256: hash(bytes)});
    complete = true;
    return output;
  } catch (error) { throw safeError(error); }
  finally {
    if (db) { if (transaction) { try { db.exec('ROLLBACK'); } catch {} } db.close(); }
    if (!complete) {
      const current = await fs.lstat(outputDirectory).catch(() => null);
      if (current?.isDirectory() && !current.isSymbolicLink() && current.dev === directoryIdentity.dev && current.ino === directoryIdentity.ino)
        await fs.rm(outputDirectory, {recursive: true, force: true});
    }
  }
}

/** Portable read-only boundary for a separate pricing worker. No networking or
 * caller-selected SQL exists. The complete source is checked before returning,
 * and an early iterator return still checks immutable file identity and bytes. */
export async function openLocalRefreshedChinaSource({descriptorPath, expectedSha256}) {
  need(typeof descriptorPath === 'string' && path.isAbsolute(descriptorPath) && path.resolve(descriptorPath) === descriptorPath &&
    path.basename(descriptorPath) === 'SOURCE.json' && HASH.test(expectedSha256 ?? ''), 'descriptor_arguments');
  const directory = path.dirname(descriptorPath), dir = await fs.lstat(directory);
  need(dir.isDirectory() && !dir.isSymbolicLink() && await fs.realpath(directory) === directory && (dir.mode & 0o077) === 0, 'descriptor_directory');
  const descriptorFile = await hashFile(descriptorPath);
  need(descriptorFile.sha256 === expectedSha256 && descriptorFile.bytes > 0 && descriptorFile.bytes <= 1024 * 1024, 'descriptor_checksum');
  const descriptor = parse(await fs.readFile(descriptorPath, 'utf8'));
  need(digest(descriptor) === expectedSha256 && descriptor.version === 1 && descriptor.kind === 'china-refreshed-source-descriptor-v1' &&
    descriptor.market === 'china' && descriptor.file?.name === 'source.sqlite' && integer(descriptor.file.bytes) && descriptor.file.bytes > 0 &&
    HASH.test(descriptor.file.sha256 ?? ''), 'descriptor_identity');
  const {manifest, reconciliation, lineage} = descriptor;
  need(manifest?.version === 1 && manifest.kind === 'china-refreshed-source-v1' && manifest.market === 'china' &&
    manifest.provider === 'auto_api_che168' && manifest.sourceId === SOURCE && HASH.test(manifest.source?.snapshotBinding ?? '') &&
    manifest.classification === 'private_source' && manifest.supplierLatestVerified === true && manifest.publicationReady === false &&
    manifest.policy?.minimumYear === 2014 && manifest.policy.finalAdmissionApplied === false &&
    instant(manifest.sourceObservedAt) && same(manifest.reconciliation, reconciliation) && same(manifest.lineage, lineage) &&
    lineage?.method === 'complete_changes_from_verified_private_source' && HASH.test(lineage.inputPrivateReceiptSha256 ?? '') &&
    HASH.test(lineage.baseSourceManifestSha256 ?? '') && (lineage.baseDescriptorSha256 === null || HASH.test(lineage.baseDescriptorSha256 ?? '')) &&
    instant(lineage.baseSourceObservedAt) && Date.parse(lineage.baseSourceObservedAt) <= Date.parse(manifest.sourceObservedAt) &&
    integer(lineage.initialCursor) && integer(manifest.source.cursor) && manifest.source.cursor >= lineage.initialCursor &&
    manifest.sourceObservedAt === lineage.terminalObservedAt && manifest.source.cursor === lineage.terminalCursor, 'manifest_identity');
  const databasePath = path.join(directory, 'source.sqlite'); let sealed;
  const verify = async () => {
    const current = await fs.lstat(directory);
    need(current.dev === dir.dev && current.ino === dir.ino && current.isDirectory() && !current.isSymbolicLink(), 'directory_changed');
    const actual = await hashFile(databasePath);
    need(actual.sha256 === descriptor.file.sha256 && actual.bytes === descriptor.file.bytes && (actual.stat.mode & 0o777) === 0o400 &&
      (!sealed || sameStat(actual.stat, sealed.stat)), 'database_changed');
    sealed ??= actual;
  };
  const open = () => { const db = new DatabaseSync(databasePath, {readOnly: true, allowExtension: false});
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;'); return db; };
  await verify(); const db = open();
  try {
    const actual = db.prepare("SELECT name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    need(same(actual.map(row => row.name), Object.keys(schema).sort()) && actual.every(row => normalizedSql(row.sql) === normalizedSql(schema[row.name])), 'database_schema');
    need(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 'database_integrity');
    const counts = {...census(db, manifest), ...deltaCounts(db)}, journal = journalSummary(db, lineage.initialCursor);
    need(Object.entries(counts).every(([key, value]) => reconciliation[key] === value) &&
      Object.entries(journal).every(([key, value]) => lineage[key] === value) && reconciliation.unresolvedDetails === 0 &&
      reconciliation.sourceRows === reconciliation.baseSourceRows + reconciliation.insertedRows - reconciliation.removedRows - reconciliation.quarantinedRows &&
      reconciliation.sourceRows === reconciliation.insertedRows + reconciliation.updatedRows + reconciliation.unchangedRows &&
      reconciliation.sourceRows === reconciliation.eligible + reconciliation.yearBeforeMinimum + reconciliation.yearUnknown &&
      reconciliation.supplierLatestVerified === true && reconciliation.sourceObservedAt === manifest.sourceObservedAt &&
      reconciliation.finalAdmissionApplied === false && reconciliation.allInputRowsAccountedFor === true &&
      reconciliation.missingValuesInvented === false && reconciliation.pricesRecalculated === false && reconciliation.publicationReady === false, 'descriptor_census');
  } finally { db.close(); }
  await verify(); freeze(descriptor);
  return Object.freeze({complete: true, manifest, reconciliation, lineage, descriptorSha256: expectedSha256,
    paths: Object.freeze({directory, database: databasePath, descriptor: descriptorPath}),
    async *offers({eligibleOnly = false} = {}) {
      need(typeof eligibleOnly === 'boolean', 'eligible_only'); await verify(); const db = open(); let count = 0;
      try {
        for (const row of db.prepare('SELECT * FROM offers' + (eligibleOnly ? ' WHERE eligible=1' : '') + ' ORDER BY id COLLATE BINARY').iterate()) {
          count++; yield checkedRow(row, manifest);
        }
        need(count === (eligibleOnly ? reconciliation.eligible : reconciliation.sourceRows), 'iteration_census');
      } finally { db.close(); await verify(); }
    }});
}
