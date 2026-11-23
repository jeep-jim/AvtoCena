// Manual offline large-volume check; not part of normal CI.
// Usage: node scripts/run-node-with-resources.mjs tests/manual/che168-witness-volume-smoke.mjs ABS_SOURCE_ROOT --large ABS_OUTPUT_JSON
import fs from 'node:fs/promises';
import {openSync, closeSync, readSync, writeSync, ftruncateSync, statSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const [sourceRoot, mode, reportPath] = process.argv.slice(2);
assert.ok(path.isAbsolute(sourceRoot || '') && ['--self-test', '--large'].includes(mode) && path.isAbsolute(reportPath || ''), 'explicit source root, fixture mode and output path required');
const started = Date.now(), base = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
let supplierRequests = 0, phase = 'setup', root;
globalThis.fetch = async () => {supplierRequests++; throw Error('offline_fixture_network_forbidden');};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const modules = Object.fromEntries(await Promise.all(['che168-replica-witness', 'che168-replica', 'che168-snapshot', 'catalog-raw-provenance']
  .map(async name => [name, await import(pathToFileURL(path.join(sourceRoot, 'scripts/lib', name + '.mjs')).href)])));
const {verifyChe168ReplicaInput, CHE168_REPLICA_WITNESS_SOURCE: SOURCE} = modules['che168-replica-witness'];
const {saveChe168Replica} = modules['che168-replica'];
const {snapshotBinding} = modules['che168-snapshot'];
const {openRawFeedPin, rawDigest} = modules['catalog-raw-provenance'];
const sourceFile = path.join(sourceRoot, 'scripts/lib/che168-replica-witness.mjs');
const sourceSha256 = sha(await fs.readFile(sourceFile));

// SQLite's documented freelist permits unused leaf pages to remain sparse.
// This creates a real, integrity-checked large database with no fake manifest
// size or checksum. The reserved lock-byte page is excluded from the freelist.
// Format: https://www.sqlite.org/fileformat.html#the_freelist
function extendFreelist(filename, bytes) {
  const fd = openSync(filename, 'r+');
  try {
    const header = Buffer.alloc(100); assert.equal(readSync(fd, header, 0, 100, 0), 100);
    const pageSize = header.readUInt16BE(16) === 1 ? 65536 : header.readUInt16BE(16);
    assert.equal(header[20], 0); assert.equal(header.readUInt32BE(32), 0); assert.equal(header.readUInt32BE(36), 0);
    assert.equal(header.readUInt32BE(52), 0); assert.equal(header.readUInt32BE(64), 0);
    const oldPages = statSync(filename).size / pageSize, pages = bytes / pageSize;
    assert.ok(Number.isSafeInteger(pages) && pages > oldPages && pages < 2 ** 32 - 1);
    const lockPage = Math.floor(1073741824 / pageSize) + 1, leavesPerTrunk = pageSize / 4 - 8;
    let next = oldPages + 1, first, written = 0;
    const take = () => {if (next === lockPage) next++; return next <= pages ? next++ : 0;};
    let trunk = take(); first = trunk; ftruncateSync(fd, bytes);
    while (trunk) {
      const leaves = [];
      for (let index = 0; index < leavesPerTrunk; index++) {const leaf = take(); if (!leaf) break; leaves.push(leaf);}
      const following = take(), page = Buffer.alloc(pageSize); page.writeUInt32BE(following, 0); page.writeUInt32BE(leaves.length, 4);
      leaves.forEach((leaf, index) => page.writeUInt32BE(leaf, 8 + index * 4));
      assert.equal(writeSync(fd, page, 0, page.length, (trunk - 1) * pageSize), pageSize);
      written += leaves.length + 1; trunk = following;
    }
    const freePages = pages - oldPages - (lockPage > oldPages && lockPage <= pages ? 1 : 0);
    assert.equal(written, freePages);
    const counter = header.readUInt32BE(24) + 1;
    header.writeUInt32BE(counter, 24); header.writeUInt32BE(pages, 28); header.writeUInt32BE(first, 32);
    header.writeUInt32BE(freePages, 36); header.writeUInt32BE(counter, 92);
    assert.equal(writeSync(fd, header, 0, header.length, 0), header.length);
    return {bytes, pages, pageSize, freePages};
  } finally {closeSync(fd);}
}

class DiskStore {
  driver = 'object'; metadata = new Map(); writes = 0; reads = 0; binaryReads = 0; nextPart = 0; partReadsInOrder = true;
  constructor(directory) {this.directory = directory;}
  binaryFile(key) {return path.join(this.directory, sha(key) + '.gz');}
  async readJson(key, fallback) {this.reads++; return structuredClone(this.metadata.get(key) ?? fallback);}
  async readJsonWithMeta(key, fallback) {const value = await this.readJson(key, fallback); const found = this.metadata.has(key); return {found, value, ...(found ? {etag: '"' + rawDigest(value) + '"'} : {})};}
  async writeJson(key, value, condition = {}) {
    const old = this.metadata.get(key);
    if (condition.ifNoneMatch && old !== undefined || condition.ifMatch && condition.ifMatch !== '"' + rawDigest(old) + '"') throw Error('storage_conflict');
    this.writes++; this.metadata.set(key, structuredClone(value));
  }
  async putBinary(key, bytes) {this.writes++; await fs.writeFile(this.binaryFile(key), bytes);}
  async getBinary(key) {
    this.binaryReads++; const index = Number(/\/(\d+)\.gz$/.exec(key)?.[1]);
    if (index !== this.nextPart++) this.partReadsInOrder = false;
    if (index % 256 === 0) console.log(JSON.stringify({stage: 'witness_volume_restore', part: index}));
    return {data: await fs.readFile(this.binaryFile(key))};
  }
}

try {
  root = await fs.mkdtemp(path.join(path.dirname(reportPath), 'che168-witness-volume-fixture-'));
  const filename = path.join(root, 'source.sqlite'), directory = path.join(root, 'observations');
  const isolated = path.join(root, 'isolated'), binary = path.join(root, 'compressed');
  await fs.mkdir(directory); await fs.mkdir(isolated); await fs.mkdir(binary);
  const db = new DatabaseSync(filename); db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE inventory(id TEXT PRIMARY KEY,payload TEXT NOT NULL,event INTEGER NOT NULL); BEGIN;');
  const insert = db.prepare('INSERT INTO inventory VALUES(?,?,?)');
  const rows = mode === '--large' ? 500001 : 3;
  const makeOffer = index => {const id = String(index + 1); return {id: sha(SOURCE + ':' + id).slice(0, 24), sourceOfferId: id, sourceId: SOURCE,
    market: 'china', operational: {provider: 'auto-api.com', detailIdentityVerified: true}};};
  phase = 'database';
  for (let index = 0; index < rows; index++) insert.run(String(index + 1), JSON.stringify(makeOffer(index)), 19);
  db.exec('COMMIT; VACUUM;'); db.close();
  const sqlite = extendFreelist(filename, (mode === '--large' ? 16 : 2) * 1024 ** 3 + 4096);
  const checkDb = new DatabaseSync(filename, {readOnly: true});
  assert.deepEqual(checkDb.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check), ['ok']);
  assert.equal(Number(checkDb.prepare('SELECT count(*) AS n FROM inventory').get().n), rows); checkDb.close();
  console.log(JSON.stringify({stage: 'witness_volume_sqlite_ready', rows, ...sqlite}));
  if (mode === '--self-test') {
    console.log(JSON.stringify({passed: true, synthetic: true, selfTest: true, rows, ...sqlite}));
  } else {
    const snapshotSource = await fs.readFile(path.join(sourceRoot, 'scripts/lib/che168-snapshot.mjs'), 'utf8');
    const host = /config\.host !== '([^']+)'/.exec(snapshotSource)?.[1]; assert.ok(host);
    const at = '2026-11-16T12:00:00.000Z', oldAt = '2026-10-09T08:09:40.000Z';
    const config = {version: 1, host, date: '2026-10-09', filename: 'active_offer.csv', delimiter: '|', initialCursor: 20,
      bytes: 100, etag: '"synthetic-volume-fixture"', modifiedAt: oldAt};
    const binding = snapshotBinding(config), journalBinding = rawDigest({binding, initialCursor: 20, base: null, replayVersion: 2});
    const journalKey = 'catalog/intake-working/che168-v1/' + BigInt('0x' + journalBinding.slice(0, 14)).toString();
    const owner = {runId: '43870000001', attempt: '1', revision: 'a'.repeat(40)}, storage = new DiskStore(binary);
    const pin = await openRawFeedPin({storage, owner, operationId: 'che168-volume-offline-fixture', references: [
      {kind: 'che168-snapshot', root: 'catalog/provider-snapshots/che168/' + binding}, {kind: 'che168-journal', root: journalKey}]});
    phase = 'observations';
    const padding = 'x'.repeat(17 * 1024), files = [], normalized = [], perFile = 250;
    let observationBytes = 0;
    for (let start = 0; start < rows; start += perFile) {
      const lines = [];
      for (let index = start; index < Math.min(rows, start + perFile); index++) {
        const offer = makeOffer(index); offer.operational = {...offer.operational, lastSeenAt: at,
          che168ActiveVerification: {method: 'snapshot_and_complete_change_stream', snapshotBinding: binding, initialCursor: 20, cursor: 20, verifiedAt: at}};
        normalized.push([offer.id, rawDigest(offer)]);
        lines.push(JSON.stringify({stage: 'detail', observedAt: at, offer, fixturePadding: padding}) + '\n');
      }
      const bytes = Buffer.from(lines.join('')), name = SOURCE + '-' + String(files.length + 1).padStart(6, '0') + '.jsonl';
      await fs.writeFile(path.join(directory, name), bytes); observationBytes += bytes.length;
      files.push({name, bytes: bytes.length, sha256: sha(bytes), rows: lines.length});
      if (files.length % 250 === 0) console.log(JSON.stringify({stage: 'witness_volume_observations', files: files.length, rows: Math.min(rows, start + perFile), bytes: observationBytes}));
    }
    assert.ok(observationBytes > 8 * 1024 ** 3); assert.ok(files.length > 2000);
    phase = 'archive';
    const replica = await saveChe168Replica({storage, filename, binding, cursor: 20, beforeWrite: key => pin.add([{kind: 'che168-replica', root: key}])});
    const manifest = storage.metadata.get(replica.key + '/manifest.json'); assert.ok(manifest.parts.length > 1024);
    const producerReport = {version: 1, provider: 'auto_api_che168', market: 'china', completed: true, startedAt: at, completedAt: at,
      sources: [{sourceId: SOURCE, provider: 'auto_api_che168', snapshotBinding: binding, snapshotStartedAt: oldAt,
        completeInventory: true, stopReason: 'source_finished', rejectedIdentity: 0, initialCursor: 20, cursor: 20, changes: 0,
        observations: rows, uniqueOffers: rows, workingJournal: {key: journalKey, binding: journalBinding}, replica}],
      rawStoragePins: [await pin.handoff()], fixtureMetadata: 'x'.repeat(4 * 1024 ** 2)};
    const reportBytes = Buffer.byteLength(JSON.stringify(producerReport)); assert.ok(reportBytes > 4 * 1024 ** 2);
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(producerReport));
    const disk = await fs.statfs(root); assert.ok(disk.bavail * disk.bsize > sqlite.bytes, 'fixture restore requires available local disk');
    storage.writes = 0; storage.reads = 0;
    const expected = normalized.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const expectedNormalized = {rows, idsSha256: rawDigest(expected.map(([id]) => id)), rowsSha256: rawDigest(expected)};
    normalized.length = 0;
    phase = 'readback'; const readbackStarted = Date.now();
    console.log(JSON.stringify({stage: 'witness_volume_verify', rows, databaseBytes: sqlite.bytes, parts: manifest.parts.length, files: files.length, observationBytes, reportBytes}));
    const witness = await verifyChe168ReplicaInput({storage, directory, config,
      producer: {runId: owner.runId, attempt: owner.attempt, sourceSha: owner.revision}, temporaryParent: isolated});
    assert.deepEqual(witness.normalized, expectedNormalized);
    assert.equal(witness.replicaReadback.databaseBytes, sqlite.bytes); assert.equal(witness.snapshot.pages, manifest.parts.length);
    assert.equal(witness.replicaReadback.inventory.observationBytes, observationBytes);
    assert.equal(witness.replicaReadback.inventory.observationFilesSha256, rawDigest(files));
    assert.equal(witness.replicaReadback.completion.reportSha256, rawDigest(producerReport));
    assert.equal(storage.binaryReads, manifest.parts.length); assert.equal(storage.partReadsInOrder, true);
    assert.equal(storage.writes, 0); assert.equal(supplierRequests, 0); assert.deepEqual(await fs.readdir(isolated), []);
    assert.equal(sha(await fs.readFile(sourceFile)), sourceSha256);
    const result = {passed: true, synthetic: true, base, sourceSha256, rows, databaseBytes: sqlite.bytes, parts: manifest.parts.length,
      observationFiles: files.length, observationBytes, reportBytes, expectedNormalized,
      allReplicaPartsChecked: true, allObservationRowsAndHashesChecked: true, readbackStable: true,
      supplierRequests, externalStorageWrites: 0, verificationWrites: storage.writes,
      elapsedMs: Date.now() - started, readbackMs: Date.now() - readbackStarted, maxRssKiB: process.resourceUsage().maxRSS};
    await fs.writeFile(reportPath, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({stage: 'witness_volume_complete', ...result}));
  }
} catch (error) {
  const result = {passed: false, synthetic: true, base, sourceSha256, phase, code: error.code || error.message,
    supplierRequests, externalStorageWrites: 0, elapsedMs: Date.now() - started};
  if (mode === '--large') await fs.writeFile(reportPath, JSON.stringify(result, null, 2) + '\n');
  console.error(JSON.stringify(result)); process.exitCode = 1;
} finally {if (root) await fs.rm(root, {recursive: true, force: true});}
