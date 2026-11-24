import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {CHINA_SOURCE_ID, chinaOfferId, normalizeChe168Row} from './normalize-che168.mjs';

const sha = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const need = (condition, code) => { if (!condition) throw Error('catalog_next_source_' + code); };
const integer = n => Number.isSafeInteger(n) && n >= 0;
const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const identity = row => typeof row?.inner_id === 'string' || typeof row?.inner_id === 'number' ? String(row.inner_id) : '';
const originValid = v => v && typeof v.key === 'string' && v.key.length > 0 && hex(v.sha256);
const safeCode = error => /^catalog_next_source_[a-z0-9_]+$/.test(error?.message || '') ? error.message : 'catalog_next_source_input_failed';
const count = (object, key) => { object[key] = (object[key] || 0) + 1; };

async function lineWriter(filename) {
  const file = await fs.open(filename, 'wx', 0o600);
  let chunks = [], bytes = 0, closed = false;
  async function flush() { if (chunks.length) { await file.writeFile(chunks.join('')); chunks = []; bytes = 0; } }
  return {async write(value) { const text = JSON.stringify(value) + '\n'; chunks.push(text); bytes += Buffer.byteLength(text); if (bytes >= 1024 * 1024) await flush(); },
    async close() { if (!closed) { closed = true; await flush(); await file.sync(); await file.close(); } }};
}
async function fileSha(filename) { const hash = createHash('sha256'); for await (const bytes of createReadStream(filename)) hash.update(bytes); return hash.digest('hex'); }

/**
 * Build a new private local source revision from saved inputs only.
 * snapshotRows yields {row:{inner_id,data}, origin:{key,sha256,line?}}.
 * assertSnapshotComplete must attest the exhausted raw stream as {rows,binding,manifestSha256}.
 * changePages yields {runId?,cursor,receivedAt,payload:{result,meta},origin}.
 * resolveSavedDetail receives {runId,cursor,changeId,innerId}; returns {row,origin} or null.
 * No publication, remote storage adapter, provider client or default live fallback exists here.
 */
export async function prepareChinaSource({source, snapshotRows, assertSnapshotComplete, changePages,
  resolveSavedDetail = async () => null, outputDir, normalize = normalizeChe168Row}) {
  need(source?.provider === 'auto_api_che168' && ['auto-api-che168-v2', 'auto-api-che168-v3'].includes(source.schema)
    && hex(source.snapshotBinding) && hex(source.snapshotManifestSha256)
    && integer(source.initialCursor) && integer(source.expectedTerminalCursor) && source.expectedTerminalCursor >= source.initialCursor
    && date(source.observedAt), 'descriptor');
  if (normalize === normalizeChe168Row) need(source.schema === 'auto-api-che168-v2', 'unsupported_schema');
  need(typeof assertSnapshotComplete === 'function' && typeof normalize === 'function'
    && snapshotRows?.[Symbol.asyncIterator] && changePages?.[Symbol.asyncIterator], 'ports');
  need(typeof outputDir === 'string' && path.isAbsolute(outputDir), 'output_directory');
  const captured = structuredClone(source), sourceHash = sha(captured);
  await fs.mkdir(outputDir, {mode: 0o700});
  const paths = {database: path.join(outputDir, 'source.sqlite'), offers: path.join(outputDir, 'offers.ndjson'),
    dispositions: path.join(outputDir, 'dispositions.ndjson'), manifest: path.join(outputDir, 'source-manifest.json'),
    reconciliation: path.join(outputDir, 'reconciliation.json')};
  let db, offers, dispositions;
  const report = {version: 1, kind: 'china-source-reconciliation-v1', sourceComplete: false, exactCursorClosure: false,
    publicationReady: false, source: {...captured, snapshotObservedAt: captured.observedAt},
    snapshot: {rows: 0, uniqueIds: 0, identicalDuplicates: 0},
    changes: {pages: 0, terminalPages: 0, records: 0, uniqueEvents: 0, duplicateEvents: 0, applied: {}, staleEvents: 0},
    final: {uniqueIds: 0, active: 0, removed: 0, unresolved: 0, normalized: 0, invalid: 0, byReason: {}, fieldWarnings: {}}};
  try {
    const handle = await fs.open(paths.database, 'wx', 0o600); await handle.close();
    db = new DatabaseSync(paths.database);
    db.exec(`PRAGMA temp_store=FILE;
      CREATE TABLE source_state(id TEXT PRIMARY KEY,state TEXT NOT NULL,payload TEXT,event INTEGER NOT NULL,observed_at TEXT NOT NULL,first_seen TEXT NOT NULL,origin TEXT NOT NULL,raw_sha TEXT NOT NULL);
      CREATE TABLE source_events(event INTEGER PRIMARY KEY,id TEXT NOT NULL,sha TEXT NOT NULL);
      CREATE TABLE source_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    const lookup = db.prepare('SELECT * FROM source_state WHERE id=?');
    const insert = db.prepare('INSERT INTO source_state VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,payload=excluded.payload,event=excluded.event,observed_at=excluded.observed_at,origin=excluded.origin,raw_sha=excluded.raw_sha');
    const eventAt = db.prepare('SELECT * FROM source_events WHERE event=?');
    const saveEvent = db.prepare('INSERT INTO source_events VALUES(?,?,?)');
    db.exec('BEGIN');
    for await (const input of snapshotRows) {
      need(originValid(input?.origin), 'snapshot_origin');
      const id = identity(input.row);
      need(/^\d+$/.test(id), 'snapshot_identity');
      const raw = JSON.stringify(input.row), digest = sha(raw), previous = lookup.get(id);
      report.snapshot.rows++;
      if (previous) {
        need(previous.raw_sha === digest, 'snapshot_duplicate_conflict');
        report.snapshot.identicalDuplicates++;
      } else {
        insert.run(id, 'active', raw, source.initialCursor - 1, source.observedAt, source.observedAt, JSON.stringify(input.origin), digest);
        report.snapshot.uniqueIds++;
      }
      if (report.snapshot.rows % 1000 === 0) db.exec('COMMIT; BEGIN');
    }
    db.exec('COMMIT');
    const snapshot = await assertSnapshotComplete();
    need(snapshot?.rows === report.snapshot.rows && snapshot.binding === captured.snapshotBinding
      && snapshot.manifestSha256 === captured.snapshotManifestSha256, 'snapshot_incomplete');
    need(report.snapshot.rows === report.snapshot.uniqueIds + report.snapshot.identicalDuplicates, 'snapshot_reconciliation');

    let cursor = captured.initialCursor, terminal = null, finalObservedAt = captured.observedAt;
    const pageDigest = createHash('sha256').update('catalog-next-che168-pages-v1\n');
    for await (const page of changePages) {
      need(page?.cursor === cursor && date(page.receivedAt) && originValid(page.origin), 'page_identity');
      const runId = page.runId === undefined ? 'single' : String(page.runId), body = page.payload;
      need(body && body.meta?.cur_change_id === cursor && Array.isArray(body.result), 'page_shape');
      if (terminal) need(runId !== terminal.runId && Date.parse(page.receivedAt) >= Date.parse(terminal.at), 'page_after_terminal');
      need(Date.parse(page.receivedAt) >= Date.parse(captured.observedAt), 'page_before_snapshot');
      pageDigest.update(JSON.stringify({runId, cursor, origin: page.origin}) + '\n');
      report.changes.pages++;
      if (!body.result.length) {
        need(body.meta.next_change_id === null || body.meta.next_change_id === undefined, 'terminal_cursor');
        terminal = {runId, cursor, at: page.receivedAt};
        finalObservedAt = page.receivedAt; report.changes.terminalPages++;
        continue;
      }
      terminal = null;
      const next = body.meta.next_change_id;
      need(integer(next) && next > cursor && next <= captured.expectedTerminalCursor, 'cursor_gap_or_overrun');
      const rows = [...body.result].sort((a, b) => a.id - b.id);
      db.exec('BEGIN');
      for (const change of rows) {
        const id = identity(change), digest = sha(change);
        need(integer(change.id) && change.id >= cursor && change.id <= next && /^\d+$/.test(id)
          && ['added', 'changed', 'removed'].includes(change.change_type), 'change_shape');
        report.changes.records++;
        const priorEvent = eventAt.get(change.id);
        if (priorEvent) {
          need(priorEvent.id === id && priorEvent.sha === digest, 'event_conflict');
          report.changes.duplicateEvents++; continue;
        }
        saveEvent.run(change.id, id, digest); report.changes.uniqueEvents++;
        const previous = lookup.get(id);
        if (previous && previous.event > change.id) { report.changes.staleEvents++; continue; }
        const at = date(change.created_at) ? change.created_at : page.receivedAt;
        if (change.change_type === 'removed') {
          insert.run(id, 'removed', previous?.payload || null, change.id, at, previous?.first_seen || at, JSON.stringify(page.origin), digest);
          count(report.changes.applied, 'provider_removed'); continue;
        }
        let rawRow, rawOrigin = page.origin, action;
        if (change.data && String(change.data.inner_id) === id && change.data.url) {
          rawRow = {inner_id: id, data: change.data}; action = 'embedded_full_detail';
        } else if (change.change_type === 'changed' && change.data && Object.keys(change.data).length === 1
          && Object.hasOwn(change.data, 'new_price') && previous?.state === 'active') {
          const value = change.data.new_price, price = Number(value);
          need((typeof value === 'string' || typeof value === 'number') && /^\d+(?:\.\d+)?$/.test(String(value))
            && Number.isFinite(price) && price > 0, 'price_change');
          rawRow = JSON.parse(previous.payload);
          need(rawRow?.data && String(rawRow.data.inner_id) === id, 'price_base_identity');
          rawRow.data.price = price; action = 'price_change';
        } else {
          const saved = await resolveSavedDetail({runId, cursor, changeId: change.id, innerId: id});
          if (saved !== null && saved !== undefined) {
            need(identity(saved.row) === id && originValid(saved.origin), 'saved_detail_identity');
            rawRow = saved.row; rawOrigin = saved.origin; action = 'saved_full_detail';
          }
        }
        if (!rawRow) {
          insert.run(id, 'unresolved', previous?.payload || null, change.id, at, previous?.first_seen || at, JSON.stringify(page.origin), digest);
          count(report.changes.applied, 'missing_saved_detail');
        } else {
          need(identity(rawRow) === id && String(rawRow.data?.inner_id) === id, 'detail_identity');
          insert.run(id, 'active', JSON.stringify(rawRow), change.id, at, previous?.first_seen || at, JSON.stringify(rawOrigin), sha(rawRow));
          count(report.changes.applied, action);
        }
      }
      db.exec('COMMIT');
      cursor = next;
    }
    need(terminal && terminal.cursor === cursor && cursor === captured.expectedTerminalCursor, 'terminal_page_missing');
    need(sha(source) === sourceHash, 'descriptor_changed');
    report.exactCursorClosure = true;
    report.source.terminalCursor = cursor; report.source.observedAt = finalObservedAt;
    report.source.pageObjectsSha256 = pageDigest.digest('hex');
    need(report.changes.records === report.changes.uniqueEvents + report.changes.duplicateEvents, 'event_reconciliation');
    offers = await lineWriter(paths.offers); dispositions = await lineWriter(paths.dispositions);
    const inventoryDigest = createHash('sha256').update('catalog-next-che168-inventory-v1\n');
    const normalizedDigest = createHash('sha256').update('catalog-next-che168-normalized-v1\n');
    for (const item of db.prepare('SELECT * FROM source_state ORDER BY id').iterate()) {
      report.final.uniqueIds++;
      inventoryDigest.update(JSON.stringify([item.id, item.state, item.event, item.raw_sha]) + '\n');
      const id = chinaOfferId(item.id), origin = JSON.parse(item.origin);
      const disposition = {id, sourceOfferId: item.id, event: item.event, rawSha256: item.raw_sha, origin};
      if (item.state === 'removed') {
        report.final.removed++; count(report.final.byReason, 'provider_removed');
        await dispositions.write({...disposition, state: 'removed', reason: 'provider_removed', observedAt: item.observed_at});
      } else if (item.state === 'unresolved') {
        report.final.unresolved++; count(report.final.byReason, 'missing_saved_detail');
        await dispositions.write({...disposition, state: 'unresolved', reason: 'missing_saved_detail'});
      } else {
        report.final.active++;
        const mapped = await normalize(JSON.parse(item.payload), {schema: captured.schema, observedAt: item.observed_at, firstSeenAt: item.first_seen});
        if (mapped?.kind === 'invalid') {
          need(typeof mapped.reason === 'string' && /^[a-z0-9_]+$/.test(mapped.reason), 'normalizer_reason');
          report.final.invalid++; count(report.final.byReason, mapped.reason);
          await dispositions.write({...disposition, state: 'invalid', reason: mapped.reason});
        } else {
          need(mapped?.kind === 'offer' && mapped.offer?.id === id && mapped.offer.sourceId === CHINA_SOURCE_ID
            && mapped.offer.sourceOfferId === item.id && mapped.offer.market === 'china'
            && mapped.offer.status === 'active' && Array.isArray(mapped.warnings), 'normalizer_identity');
          for (const warning of mapped.warnings) { need(/^[a-z0-9_]+$/.test(warning), 'normalizer_warning'); count(report.final.fieldWarnings, warning); }
          const offer = mapped.offer;
          offer.operational = {...offer.operational, lastSeenAt: finalObservedAt,
            che168ActiveVerification: {method: 'snapshot_and_complete_change_stream', snapshotBinding: captured.snapshotBinding,
              initialCursor: captured.initialCursor, cursor, verifiedAt: finalObservedAt}};
          const value = {offer, source: {provider: 'auto_api_che168', sourceId: CHINA_SOURCE_ID,
            schema: captured.schema, snapshotBinding: captured.snapshotBinding, initialCursor: captured.initialCursor, terminalCursor: cursor,
            observedAt: finalObservedAt, rawSha256: item.raw_sha, origin}};
          await offers.write(value); normalizedDigest.update(JSON.stringify(value) + '\n');
          await dispositions.write({...disposition, state: 'normalized', warnings: mapped.warnings}); report.final.normalized++;
        }
      }
    }
    need(report.final.uniqueIds === report.final.active + report.final.removed + report.final.unresolved
      && report.final.active === report.final.normalized + report.final.invalid, 'final_reconciliation');
    report.rawInventorySha256 = inventoryDigest.digest('hex'); report.normalizedSha256 = normalizedDigest.digest('hex');
    await offers.close(); await dispositions.close(); offers = null; dispositions = null;
    need(report.final.unresolved === 0, 'unresolved_details');
    report.sourceComplete = true;
    report.normalizationComplete = report.final.invalid === 0;
    db.prepare('INSERT INTO source_metadata VALUES(?,?)').run('reconciliation', JSON.stringify(report));
    need(db.prepare('PRAGMA quick_check').get().quick_check === 'ok', 'sqlite_integrity');
    db.close(); db = null;
    await fs.writeFile(paths.reconciliation, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    const files = {};
    for (const name of ['database', 'offers', 'dispositions', 'reconciliation']) {
      const stat = await fs.stat(paths[name]); files[name] = {file: path.basename(paths[name]), bytes: stat.size, sha256: await fileSha(paths[name])};
    }
    const manifest = {version: 1, kind: 'china-source-snapshot-v1', classification: 'private_source', sourceComplete: true, exactCursorClosure: true,
      normalizationComplete: report.normalizationComplete, publicationReady: false, source: report.source,
      reconciliation: report.final, files};
    await fs.writeFile(paths.manifest, JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    return {source: manifest.source, reconciliation: report, paths, async *offers() {
      const input = createReadStream(paths.offers), digest = createHash('sha256'); let rows = 0;
      input.on('data', bytes => digest.update(bytes));
      try {
        for await (const line of createInterface({input, crlfDelay: Infinity})) {
          let value;
          try { value = JSON.parse(line); } catch { throw Error('catalog_next_source_normalized_file_changed'); }
          rows++; yield value;
        }
        need(rows === report.final.normalized && digest.digest('hex') === files.offers.sha256, 'normalized_file_changed');
      } finally { input.destroy(); }
    }};
  } catch (error) {
    report.sourceComplete = false; report.failure = safeCode(error);
    await fs.writeFile(path.join(outputDir, 'incomplete.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600}).catch(() => {});
    throw Error(report.failure);
  } finally { await offers?.close(); await dispositions?.close(); db?.close(); }
}
