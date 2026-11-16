import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';
import {openRawFeedPin, rawProducerOwner, rawDigest, rawReferences, RAW_PIN_PREFIX,
  assertRawHandoff, assertRawPin, assertDurableIntakeArchive} from './catalog-raw-provenance.mjs';
import {catalogStorageBudget} from './catalog-storage-budget.mjs';

export const NONJP_INTAKE_MARKETS = Object.freeze(['china', 'korea', 'uae', 'europe', 'georgia']);
export const INTAKE_ARCHIVE_RECEIPT = 'own-storage-receipt.json';
const PART_BYTES = 2 * 1024 * 1024, MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 20000, MAX_TOTAL_BYTES = 128 * 1024 ** 3, HEX = /^[a-f0-9]{64}$/;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fileName = name => name === 'report.json' || /^[a-z0-9_-]+-[0-9]{6}\.jsonl$/i.test(name);

export function intakeArchiveRoot(market, owner) {
  assert.ok(NONJP_INTAKE_MARKETS.includes(market), 'intake_archive_market');
  rawProducerOwner({GITHUB_RUN_ID: owner?.runId, GITHUB_RUN_ATTEMPT: owner?.attempt, GITHUB_SHA: owner?.revision});
  return `catalog/nonjp-intake/v1/${market}/${owner.runId}/${owner.attempt}`;
}

export function validateIntakeArchive(manifest, expectedRoot, expectedDigest) {
  assert.ok(Buffer.byteLength(JSON.stringify(manifest)) <= MAX_MANIFEST_BYTES, 'intake_archive_manifest_bytes');
  assert.ok(manifest?.version === 1 && manifest.kind === 'nonjp-intake'
    && intakeArchiveRoot(manifest.market, manifest.owner) === expectedRoot
    && HEX.test(expectedDigest || '') && rawDigest(manifest) === expectedDigest && HEX.test(manifest.reportDigest || ''), 'intake_archive_identity');
  assert.ok(typeof manifest.collection?.complete === 'boolean' && (manifest.collection.qualityStatus === null
    || typeof manifest.collection.qualityStatus === 'string' && manifest.collection.qualityStatus.length <= 100), 'intake_archive_collection');
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= MAX_FILES,
    'intake_archive_file_count');
  const names = new Set(); let total = 0;
  for (const file of manifest.files) {
    assert.ok(fileName(file?.name) && !names.has(file.name) && HEX.test(file.sha256 || '')
      && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= MAX_FILE_BYTES
      && Array.isArray(file.parts) && file.parts.length === Math.ceil(file.bytes / PART_BYTES), 'intake_archive_file');
    names.add(file.name); total += file.bytes;
    for (const [index, part] of file.parts.entries()) {
      assert.ok(part.key === `${expectedRoot}/files/${file.name}/${index}-${part.sha256}.json`
        && HEX.test(part.sha256 || '') && part.bytes === Math.min(PART_BYTES, file.bytes - index * PART_BYTES),
      'intake_archive_part');
    }
  }
  assert.ok(names.has('report.json') && manifest.files.find(file => file.name === 'report.json').bytes > 0
    && manifest.totalBytes === total && total <= MAX_TOTAL_BYTES,
    'intake_archive_bytes');
  return manifest;
}

async function immutableJson(storage, key, value) {
  try { await storage.writeJson(key, value, {ifNoneMatch: '*'}); }
  catch (error) { if (error?.name !== 'StorageConflictError') throw error; }
  assert.equal(rawDigest(await storage.readJson(key, null)), rawDigest(value), 'intake_archive_write_readback');
}

async function assertArchiveReserve(storage, files) {
  assert.equal(typeof storage.listBucketObjects, 'function', 'intake_archive_bucket_inventory_missing');
  const objects = await storage.listBucketObjects('');
  assert.ok(Array.isArray(objects) && objects.length <= 1000000
    && objects.every(row => Number.isSafeInteger(row.size) && row.size >= 0), 'intake_archive_bucket_inventory_invalid');
  const budget = catalogStorageBudget(objects.reduce((sum, row) => sum + row.size, 0), files.reduce((sum, row) => sum + row.bytes, 0));
  assert.ok(budget.ok, 'intake_archive_storage_reserve_insufficient');
}

async function localInventory(directory) {
  const entries = await fs.readdir(directory, {withFileTypes: true});
  assert.ok(entries.length > 0 && entries.length <= MAX_FILES + 1, 'intake_archive_file_count');
  const files = [];
  for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
    if (entry.name === INTAKE_ARCHIVE_RECEIPT) { assert.ok(entry.isFile(), 'intake_archive_receipt_type'); continue; }
    assert.ok(entry.isFile() && fileName(entry.name), 'intake_archive_local_path');
    const target = path.join(directory, entry.name), stat = await fs.lstat(target);
    assert.ok(stat.isFile() && stat.size <= MAX_FILE_BYTES, 'intake_archive_local_size');
    const bytes = await fs.readFile(target);
    assert.equal(bytes.length, stat.size, 'intake_archive_source_changed');
    files.push({name: entry.name, bytes: bytes.length, sha256: digest(bytes)});
  }
  assert.ok(files.some(row => row.name === 'report.json') && files.reduce((sum,row) => sum + row.bytes,0) <= MAX_TOTAL_BYTES,
    'intake_archive_local_inventory');
  return files;
}

function decodePart(value, expected) {
  assert.ok(value?.version === 1 && value.encoding === 'gzip-base64' && value.bytes === expected.bytes
    && value.sha256 === expected.sha256 && typeof value.payload === 'string'
    && value.payload.length <= (PART_BYTES + 65536) * 2, 'intake_archive_part_wire');
  const encoded = Buffer.from(value.payload, 'base64');
  assert.equal(encoded.toString('base64'), value.payload, 'intake_archive_part_base64');
  const bytes = gunzipSync(encoded, {maxOutputLength: PART_BYTES});
  assert.ok(bytes.length === expected.bytes && digest(bytes) === expected.sha256, 'intake_archive_part_checksum');
  return bytes;
}

/** Small immutable identity check used again before publication; full parts were
 * already verified by restore. This does not label provider coverage complete. */
export async function readIntakeArchiveManifest({storage, receipt}) {
  assert.equal(storage.driver, 'object', 'intake_archive_requires_object_storage');
  assertDurableIntakeArchive(receipt);
  const root = intakeArchiveRoot(receipt.market, receipt.owner);
  assert.ok(receipt.version === 1 && receipt.root === root && receipt.handoff.references.some(row =>
    row.kind === 'nonjp-intake' && row.root === root && row.sha256 === receipt.manifestSha256), 'intake_archive_receipt');
  const manifest = validateIntakeArchive(await storage.readJson(root + '/complete.json', null), root, receipt.manifestSha256);
  assert.equal(manifest.reportDigest, receipt.reportDigest, 'intake_archive_report_changed');
  assert.equal(rawDigest(manifest.owner),rawDigest(receipt.owner),'intake_archive_producer_changed');
  const pin=assertRawPin(await storage.readJson(receipt.handoff.key,null));
  assert.ok(['ready','published'].includes(pin.state) && pin.readyAt === receipt.handoff.readyAt
    && pin.operationId === receipt.handoff.operationId && rawDigest(pin.owner) === rawDigest(receipt.handoff.owner)
    && rawDigest(pin.references) === receipt.handoff.referencesSha256,'intake_archive_pin_changed');
  return manifest;
}

/** Saved observations are restored byte-for-byte; this never contacts a supplier. */
export async function verifyIntakeArchive({storage, receipt, directory}) {
  const manifest = await readIntakeArchiveManifest({storage, receipt});
  const root = receipt.root;
  if (directory) {
    await fs.mkdir(directory, {recursive: true});
    assert.equal((await fs.readdir(directory)).length, 0, 'intake_archive_restore_not_empty');
  }
  for (const file of manifest.files) {
    const hash = createHash('sha256'); let size = 0;
    const output = directory ? await fs.open(path.join(directory, file.name), 'wx') : null;
    try {
      for (const part of file.parts) {
        const bytes = decodePart(await storage.readJson(part.key, null), part);
        hash.update(bytes); size += bytes.length;
        if (output) await output.writeFile(bytes);
      }
    } finally { if (output) await output.close(); }
    assert.ok(size === file.bytes && hash.digest('hex') === file.sha256, 'intake_archive_file_checksum');
  }
  assert.equal(rawDigest(await storage.readJson(root + '/complete.json', null)), receipt.manifestSha256,
    'intake_archive_complete_changed');
  if (directory) await fs.writeFile(path.join(directory, INTAKE_ARCHIVE_RECEIPT), JSON.stringify(receipt));
  return manifest;
}

export function attachIntakeArchiveReceipt(report, receipt) {
  receipt = assertDurableIntakeArchive(receipt, report?.market);
  assert.equal(rawDigest(report), receipt.reportDigest, 'intake_archive_report_changed');
  const pins = report.rawStoragePins || [];
  assert.ok(Array.isArray(pins) && pins.length < 64, 'intake_archive_pin_limit');
  pins.forEach(assertRawHandoff);
  const byId = new Map(pins.map(pin => [pin.operationId, pin]));
  const prior = byId.get(receipt.handoff.operationId);
  assert.ok(!prior || rawDigest(prior) === rawDigest(receipt.handoff), 'intake_archive_pin_conflict');
  byId.set(receipt.handoff.operationId, receipt.handoff);
  return {...report, durableIntakeArchive: receipt, rawStoragePins: [...byId.values()]};
}

async function writeLocalReceipt(receiptPath, receipt) {
  try { await fs.writeFile(receiptPath, JSON.stringify(receipt), {flag: 'wx'}); }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    assert.equal(rawDigest(JSON.parse(await fs.readFile(receiptPath, 'utf8'))), rawDigest(receipt), 'intake_archive_local_receipt_changed');
  }
}

function receiptFromReadyPin({market, owner, root, manifest, pin}) {
  assertRawPin(pin);
  const operationId = `nonjp-intake-${market}-${owner.runId}-${owner.attempt}`;
  assert.ok(['ready', 'published'].includes(pin.state) && pin.operationId === operationId
    && rawDigest(pin.owner) === rawDigest(owner), 'intake_archive_pin_changed');
  const references = rawReferences(pin.references), handoff = {version: 1, key: RAW_PIN_PREFIX + operationId + '.json',
    operationId, owner: pin.owner, readyAt: pin.readyAt, references, referencesSha256: rawDigest(references)};
  return assertDurableIntakeArchive({version: 1, market, owner, root, manifestSha256: rawDigest(manifest),
    reportDigest: manifest.reportDigest, handoff});
}

/** Immutable private copy of the entire collected dataset, including partial
 * observations. A complete ARCHIVE never claims a complete supplier inventory. */
export async function archiveIntakeDirectory({storage, directory, market, owner = rawProducerOwner()}) {
  assert.equal(storage.driver, 'object', 'intake_archive_requires_object_storage');
  const files = await localInventory(directory), report = JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8'));
  assert.equal(report.market, market, 'intake_archive_report_market');
  const receiptPath = path.join(directory, INTAKE_ARCHIVE_RECEIPT);
  let saved;
  try { saved = JSON.parse(await fs.readFile(receiptPath,'utf8')); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (saved) {
    assert.equal(saved.market, market, 'intake_archive_receipt_market');
    const manifest = await verifyIntakeArchive({storage, receipt:saved});
    assert.equal(rawDigest(manifest.files.map(({parts,...file})=>file)),rawDigest(files),'intake_archive_source_changed');
    return saved;
  }
  const root = intakeArchiveRoot(market, owner);
  const operationId=`nonjp-intake-${market}-${owner.runId}-${owner.attempt}`;
  // Recovery after ready/published but before the local receipt must be read-only.
  // No reopen/add is permitted on a frozen producer pin.
  const completed = await storage.readJson(root + '/complete.json', null);
  if (completed !== null) {
    validateIntakeArchive(completed, root, rawDigest(completed));
    assert.equal(rawDigest(completed.files.map(({parts, ...file}) => file)), rawDigest(files), 'intake_archive_source_changed');
    const savedPin = await storage.readJson(RAW_PIN_PREFIX + operationId + '.json', null);
    if (['ready', 'published'].includes(savedPin?.state)) {
      const receipt = receiptFromReadyPin({market, owner, root, manifest: completed, pin: savedPin});
      await verifyIntakeArchive({storage, receipt});
      await writeLocalReceipt(receiptPath, receipt);
      return receipt;
    }
  }
  await assertArchiveReserve(storage, files);
  const pin = await openRawFeedPin({storage, owner, operationId,
    references:[{kind:'nonjp-intake',root}]});
  await pin.add([]);
  const storedFiles=[];
  for (const file of files) {
    const bytes = await fs.readFile(path.join(directory,file.name));
    assert.ok(bytes.length === file.bytes && digest(bytes) === file.sha256,'intake_archive_source_changed');
    const parts=[];
    for (let offset=0;offset<bytes.length;offset+=PART_BYTES) {
      const part=bytes.subarray(offset,offset+PART_BYTES), sha256=digest(part);
      const key=`${root}/files/${file.name}/${parts.length}-${sha256}.json`;
      await immutableJson(storage,key,{version:1,encoding:'gzip-base64',bytes:part.length,sha256,
        payload:gzipSync(part,{level:6}).toString('base64')});
      parts.push({key,bytes:part.length,sha256});
    }
    storedFiles.push({...file,parts});
  }
  assert.equal(rawDigest(await localInventory(directory)),rawDigest(files),'intake_archive_source_changed');
  const manifest={version:1,kind:'nonjp-intake',market,owner,files:storedFiles,
    reportDigest:rawDigest(report),
    totalBytes:files.reduce((sum,row)=>sum+row.bytes,0),
    collection:{complete:report.completed===true,qualityStatus:typeof report.qualityStatus==='string'?report.qualityStatus:null}};
  const manifestSha256=rawDigest(manifest);
  validateIntakeArchive(manifest,root,manifestSha256);
  await immutableJson(storage,root+'/complete.json',manifest);
  await pin.add([{kind:'nonjp-intake',root,sha256:manifestSha256}]);
  const receipt={version:1,market,owner,root,manifestSha256,reportDigest:manifest.reportDigest,handoff:await pin.handoff()};
  await verifyIntakeArchive({storage,receipt});
  await writeLocalReceipt(receiptPath,receipt);
  return receipt;
}
