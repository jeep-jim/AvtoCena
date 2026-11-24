import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const SOURCE_ID = 'autohome_used_china_open';
const SHA = /^[a-f0-9]{64}$/;
const RUN = /^[1-9]\d{0,19}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SHARD = /^autohome_used_china_open-\d{6,}\.jsonl$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonDigest = value => digest(JSON.stringify(value));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const need = (value, code) => assert(value, 'china_saved_' + code);
function parseJson(bytes, code) {
  try { return JSON.parse(bytes); } catch { throw Error('china_saved_' + code); }
}

async function hashFile(filename) {
  const stat = await fs.lstat(filename);
  need(stat.isFile() && !stat.isSymbolicLink(), 'file_type');
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(filename)) { hash.update(chunk); bytes += chunk.length; }
  need(bytes === stat.size, 'file_changed');
  return {bytes, sha256: hash.digest('hex')};
}

function validateArchive(head, archive, manifest) {
  need(head?.version === 1 && head.market === 'china' && RUN.test(head.runId ?? '') &&
    head.rateRun === head.runId && integer(head.cursor) && integer(head.observations) && head.observations > 0,
  'head_identity');
  const owner = archive?.owner;
  need(RUN.test(owner?.runId ?? '') && /^[1-9]\d{0,5}$/.test(owner?.attempt ?? '') && COMMIT.test(owner?.revision ?? ''), 'archive_owner');
  const root = `catalog/nonjp-intake/v1/china/${owner.runId}/${owner.attempt}`;
  need(archive.version === 1 && archive.market === 'china' && archive.root === root && head.archiveRoot === root &&
    SHA.test(archive.manifestSha256 ?? '') && archive.manifestSha256 === head.archiveSha256 &&
    manifest?.version === 1 && manifest.kind === 'nonjp-intake' && manifest.market === 'china' &&
    jsonDigest(manifest.owner) === jsonDigest(owner) && jsonDigest(manifest) === archive.manifestSha256 &&
    manifest.collection?.complete === true && SHA.test(manifest.reportDigest ?? '') &&
    manifest.reportDigest === archive.reportDigest && Array.isArray(manifest.files) && manifest.files.length > 1,
  'archive_identity');
  const seen = new Set(); let bytes = 0;
  for (const file of manifest.files) {
    need((file?.name === 'report.json' || SHARD.test(file?.name ?? '')) && !seen.has(file.name) &&
      integer(file.bytes) && file.bytes > 0 && SHA.test(file.sha256 ?? ''), 'archive_file');
    seen.add(file.name); bytes += file.bytes;
  }
  need(seen.has('report.json') && integer(bytes) && bytes === manifest.totalBytes, 'archive_bytes');
  const report = manifest.files.find(file => file.name === 'report.json');
  need(report.sha256 === manifest.reportDigest, 'report_digest');
  const shards = manifest.files.filter(file => SHARD.test(file.name)).sort((a, b) => a.name.localeCompare(b.name));
  shards.forEach((file, index) => need(file.name === `${SOURCE_ID}-${String(index + 1).padStart(6, '0')}.jsonl`, 'shard_sequence'));
  return {shards, report};
}

function validateReport(report, head, archive) {
  need(report?.version === 1 && report.market === 'china' && report.completed === true && !report.failure &&
    instant(report.startedAt) && instant(report.completedAt) && report.startedAt <= report.completedAt &&
    Array.isArray(report.sources) && report.sources.length === 1, 'report_complete');
  const source = report.sources[0];
  need(source?.sourceId === SOURCE_ID && source.provider === 'auto_api_che168' && source.ownedFeedRun === head.runId &&
    source.completeInventory === true && source.stopReason === 'source_finished' && source.rejectedIdentity === 0 &&
    !source.partial && !source.failure && source.cursor === head.cursor && integer(source.initialCursor) &&
    source.initialCursor <= source.cursor && source.uniqueOffers === head.observations && source.observations === head.observations &&
    SHA.test(source.snapshotBinding ?? '') && source.replica?.binding === source.snapshotBinding &&
    source.replica.cursor === source.cursor && SHA.test(source.replica.sha256 ?? '') &&
    /^catalog\/provider-replicas\/che168\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(source.replica.key ?? ''), 'source_lineage');
  // This is a migration of a previously fully verified saved snapshot. It is
  // not a new claim about the supplier's current state or an unbounded DUMP.
  const witness = report.sourceInputWitness;
  const {checksum, ...witnessBody} = witness ?? {};
  const {sourceInputWitness, ...reportBody} = report;
  need(witness?.version === 1 && witness.kind === 'independent_che168_replica_v1' && witness.sourceId === SOURCE_ID &&
    SHA.test(checksum ?? '') && jsonDigest(witnessBody) === checksum &&
    witness.producer?.runId === archive.owner.runId && witness.producer.attempt === archive.owner.attempt &&
    witness.producer.sourceSha === archive.owner.revision && witness.snapshot?.root === source.replica.key &&
    witness.snapshot.completeSha256 === source.replica.sha256 && witness.snapshot.rows === head.observations &&
    witness.snapshot.completedAt === report.completedAt && witness.normalized?.rows === head.observations &&
    SHA.test(witness.normalized.idsSha256 ?? '') && SHA.test(witness.normalized.rowsSha256 ?? '') &&
    witness.replicaReadback?.method === 'closed_sqlite_restore_and_full_output_comparison' &&
    witness.replicaReadback.integrity === 'ok' && witness.replicaReadback.binding === source.snapshotBinding &&
    witness.replicaReadback.cursor === head.cursor && witness.replicaReadback.replayInitialCursor === source.initialCursor &&
    witness.replicaReadback.completion?.reportSha256 === jsonDigest(reportBody), 'replica_witness');
  return {source, witness};
}

async function* verifiedLines(filename, expected) {
  const stat = await fs.lstat(filename);
  need(stat.isFile() && !stat.isSymbolicLink() && stat.size === expected.bytes, 'input_file');
  const hash = createHash('sha256'); let bytes = 0, carry = Buffer.alloc(0);
  for await (const chunk of createReadStream(filename)) {
    bytes += chunk.length; hash.update(chunk);
    carry = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let start = 0;
    for (;;) {
      const end = carry.indexOf(10, start); if (end < 0) break;
      need(end > start, 'empty_line');
      let line;
      try { line = new TextDecoder('utf-8', {fatal: true}).decode(carry.subarray(start, end)); }
      catch { throw Error('china_saved_invalid_utf8'); }
      yield parseJson(line, 'invalid_record_json'); start = end + 1;
    }
    carry = carry.subarray(start);
    // Bound one hostile record, not the market or total source size.
    need(carry.length <= 16 * 1024 * 1024, 'record_size');
  }
  need(carry.length === 0 && bytes === expected.bytes && hash.digest('hex') === expected.sha256, 'input_checksum');
}

/** All input files must already have been restored from the captured private
 * archive. This module has no network, provider, FX, encyclopedia or remote-write
 * interface. Old published data is not an input and cannot be changed here. */
export async function buildSavedChinaSource({inputDirectory, outputDirectory, head, archive, manifest, downloadCut,
  minimumYear = 2014, assertCurrent = async () => {}, onProgress = () => {}}) {
  need(minimumYear === 2014, 'year_policy');
  need(path.isAbsolute(inputDirectory) && path.isAbsolute(outputDirectory) &&
    path.resolve(inputDirectory) !== path.resolve(outputDirectory), 'directories');
  const files = validateArchive(head, archive, manifest);
  const expectedNames = new Set(manifest.files.map(file => file.name));
  for (const name of await fs.readdir(inputDirectory)) need(expectedNames.has(name) || name === 'own-storage-receipt.json', 'unexpected_input');
  const reportBytes = await fs.readFile(path.join(inputDirectory, 'report.json'));
  need(reportBytes.length === files.report.bytes && digest(reportBytes) === files.report.sha256, 'report_checksum');
  const report = parseJson(reportBytes, 'invalid_report_json'), {source, witness} = validateReport(report, head, archive);
  need(downloadCut?.version === 1 && downloadCut.market === 'china' && downloadCut.status === 'complete' &&
    downloadCut.runId === head.runId && downloadCut.cursor === head.cursor && downloadCut.startCursor === source.initialCursor &&
    downloadCut.rows === source.changes && instant(downloadCut.completedAt) &&
    Date.parse(downloadCut.completedAt) <= Date.parse(report.completedAt), 'download_cut');
  const sourceObservedAt = downloadCut.completedAt;
  await assertCurrent();
  await fs.mkdir(outputDirectory, {mode: 0o700});
  const paths = {database: path.join(outputDirectory, 'source.sqlite'), dispositions: path.join(outputDirectory, 'dispositions.ndjson'),
    reconciliation: path.join(outputDirectory, 'reconciliation.json'), manifest: path.join(outputDirectory, 'source-manifest.json')};
  const db = new DatabaseSync(paths.database, {allowExtension: false});
  await fs.chmod(paths.database, 0o600);
  const ledger = await fs.open(paths.dispositions, 'wx', 0o600);
  let closed = false;
  const counts = {sourceRows: 0, eligible: 0, yearBeforeMinimum: 0, yearUnknown: 0, missingPrice: 0, missingPower: 0};
  try {
    db.exec(`PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA temp_store=FILE;
      CREATE TABLE offers(id TEXT PRIMARY KEY, source_offer_id TEXT NOT NULL UNIQUE, year INTEGER,
        eligible INTEGER NOT NULL, disposition TEXT NOT NULL, payload TEXT NOT NULL, payload_sha256 TEXT NOT NULL);
      BEGIN;`);
    const put = db.prepare('INSERT INTO offers VALUES(?,?,?,?,?,?,?)');
    for (const [index, file] of files.shards.entries()) {
      for await (const observation of verifiedLines(path.join(inputDirectory, file.name), file)) {
        const offer = observation?.offer, active = offer?.operational?.che168ActiveVerification;
        need(observation?.stage === 'detail' && observation.observedAt === report.completedAt &&
          offer?.market === 'china' && offer.sourceId === SOURCE_ID && offer.status === 'active' &&
          typeof offer.sourceOfferId === 'string' && /^\d{1,32}$/.test(offer.sourceOfferId) &&
          offer.id === digest(SOURCE_ID + ':' + offer.sourceOfferId).slice(0, 24) &&
          offer.operational?.provider === 'auto-api.com' && offer.operational.detailIdentityVerified === true &&
          active?.method === 'snapshot_and_complete_change_stream' && active.snapshotBinding === source.snapshotBinding &&
          active.cursor === source.cursor && active.verifiedAt === report.completedAt, 'observation_identity');
        const year = Number.isSafeInteger(offer.year) && offer.year >= 1886 &&
          offer.year <= new Date(sourceObservedAt).getUTCFullYear() + 1 ? offer.year : null;
        const disposition = year === null ? 'year_unknown' : year < minimumYear ? 'year_before_minimum' : 'eligible';
        const eligible = disposition === 'eligible';
        const payload = JSON.stringify(offer), payloadSha256 = digest(payload);
        try { put.run(offer.id, offer.sourceOfferId, year, eligible ? 1 : 0, disposition, payload, payloadSha256); }
        catch (error) { if (error?.code === 'ERR_SQLITE_ERROR') throw Error('china_saved_duplicate_or_invalid_id'); throw error; }
        await ledger.writeFile(JSON.stringify({id: offer.id, sourceOfferId: offer.sourceOfferId, year, disposition, payloadSha256}) + '\n');
        counts.sourceRows++;
        if (eligible) counts.eligible++; else if (year === null) counts.yearUnknown++; else counts.yearBeforeMinimum++;
        if (!(typeof offer.sourcePrice === 'number' && Number.isFinite(offer.sourcePrice) && offer.sourcePrice > 0)) counts.missingPrice++;
        if (!(typeof offer.powerHp === 'number' && Number.isFinite(offer.powerHp) && offer.powerHp > 0)) counts.missingPower++;
      }
      // Complete shards are bounded by the producer, while the dataset itself
      // has no fixed vehicle-count or total-byte ceiling.
      db.exec('COMMIT; BEGIN;');
      if ((index + 1) % 25 === 0) {
        await assertCurrent(); onProgress({phase: 'saved_china_materialization', shards: index + 1, ...counts});
      }
    }
    db.exec('COMMIT; CREATE INDEX offers_eligible_year ON offers(eligible,year,id);');
    need(counts.sourceRows === head.observations && counts.sourceRows === counts.eligible + counts.yearBeforeMinimum + counts.yearUnknown,
      'source_reconciliation');
    const ids = createHash('sha256').update('['), rows = createHash('sha256').update('['); let count = 0;
    for (const row of db.prepare('SELECT id,payload_sha256 FROM offers ORDER BY id COLLATE BINARY').iterate()) {
      if (count++) { ids.update(','); rows.update(','); }
      ids.update(JSON.stringify(row.id)); rows.update(JSON.stringify([row.id, row.payload_sha256]));
    }
    const idsSha256 = ids.update(']').digest('hex'), rowsSha256 = rows.update(']').digest('hex');
    need(count === counts.sourceRows && idsSha256 === witness.normalized.idsSha256 &&
      rowsSha256 === witness.normalized.rowsSha256, 'full_replica_comparison');
    need(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 'sqlite_integrity');
    db.close(); closed = true; await ledger.close();
    await assertCurrent();
    // Re-read the local immutable header too; a changed archive cannot be
    // sealed merely because all original filenames were consumed.
    need(digest(await fs.readFile(path.join(inputDirectory, 'report.json'))) === archive.reportDigest, 'report_changed');
    const reconciliation = {version: 1, market: 'china', inputCoverage: 'saved_normalized_complete_replica',
      sourceObservedAt, supplierLatestVerified: false, minimumYear, ...counts,
      sourceReportedQuarantined: integer(source.quarantined) ? source.quarantined : null,
      allInputRowsAccountedFor: true, idsSha256, rowsSha256,
      missingValuesInvented: false, pricesRecalculated: false, publicationReady: false};
    await fs.writeFile(paths.reconciliation, JSON.stringify(reconciliation), {flag: 'wx', mode: 0o600});
    const outputFiles = [];
    for (const filename of [paths.database, paths.dispositions, paths.reconciliation])
      outputFiles.push({name: path.basename(filename), ...await hashFile(filename)});
    const result = {version: 1, kind: 'china-saved-source-v1', classification: 'private_source', market: 'china',
      provider: 'auto_api_che168', sourceId: SOURCE_ID, preparedAt: new Date().toISOString(),
      sourceObservedAt, supplierLatestVerified: false,
      source: {runId: head.runId, cursor: head.cursor, snapshotBinding: source.snapshotBinding,
        archiveRoot: archive.root, archiveSha256: archive.manifestSha256, reportSha256: archive.reportDigest,
        replicaSha256: source.replica.sha256, witnessSha256: witness.checksum, downloadCutSha256: jsonDigest(downloadCut)},
      policy: {minimumYear}, reconciliation, files: outputFiles, publicationReady: false};
    await fs.writeFile(paths.manifest, JSON.stringify(result), {flag: 'wx', mode: 0o600});
    const databaseSeal = outputFiles.find(file => file.name === 'source.sqlite');
    return {manifest: result, manifestPath: paths.manifest, paths, reconciliation,
      async *offers({eligibleOnly = true} = {}) {
        const before = await hashFile(paths.database);
        need(before.sha256 === databaseSeal.sha256 && before.bytes === databaseSeal.bytes, 'prepared_source_changed');
        const read = new DatabaseSync(paths.database, {readOnly: true, allowExtension: false});
        try {
          read.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
          for (const row of read.prepare('SELECT payload FROM offers' + (eligibleOnly ? ' WHERE eligible=1' : '') + ' ORDER BY id COLLATE BINARY').iterate())
            yield parseJson(row.payload, 'invalid_prepared_json');
        } finally { read.close(); }
        const after = await hashFile(paths.database);
        need(after.sha256 === databaseSeal.sha256 && after.bytes === databaseSeal.bytes, 'prepared_source_changed');
      }};
  } catch (error) {
    await fs.writeFile(path.join(outputDirectory, 'incomplete.json'), JSON.stringify({version: 1, market: 'china',
      complete: false, publicationReady: false, counts}), {flag: 'wx', mode: 0o600}).catch(() => {});
    throw error;
  } finally {
    if (!closed) db.close();
    await ledger.close().catch(() => {});
  }
}
