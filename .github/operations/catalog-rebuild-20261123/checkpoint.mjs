import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const boundaryBytes = readFileSync(new URL('./boundaries.json', import.meta.url));
const rawBoundaries = JSON.parse(boundaryBytes.toString('utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = /^[a-f0-9]{40}$/;
const checksum = /^[a-f0-9]{64}$/;
const runPattern = /^[1-9]\d{0,19}$/;
const attemptPattern = /^[1-9]\d{0,5}$/;
// Legacy deletePrefix('catalog') uses a raw S3 prefix, including catalog-* keys.
const namespace = 'rebuild-checkpoints/catalog/20261123';

export class CheckpointError extends Error {
  constructor(code) { super(code); this.name = 'CheckpointError'; this.code = code; }
}
function requireValue(ok, code) { if (!ok) throw new CheckpointError(code); }
function storageKey(key) {
  return typeof key === 'string' && key.length < 512 && key.endsWith('.json')
    && /^[A-Za-z0-9_./-]+$/.test(key)
    && key.split('/').every(part => part && part !== '.' && part !== '..');
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
requireValue(rawBoundaries.version === 1 && rawBoundaries.repository === 'jeep-jim/AvtoCena'
  && rawBoundaries.checkpointPrefix === namespace && !namespace.startsWith('catalog')
  && rawBoundaries.fullBackup === false
  && rawBoundaries.deletionAllowed === false && Array.isArray(rawBoundaries.roots)
  && rawBoundaries.roots.length > 0, 'checkpoint_boundary_invalid');
const rootKeys = new Set();
for (const root of rawBoundaries.roots) {
  requireValue(storageKey(root.key) && !root.key.startsWith(namespace + '/')
    && !rootKeys.has(root.key) && ['copy', 'fingerprint'].includes(root.mode)
    && typeof root.required === 'boolean'
    && (root.mode !== 'copy' || root.key.startsWith('catalog/')), 'checkpoint_boundary_invalid');
  rootKeys.add(root.key);
}
requireValue(rootKeys.has(rawBoundaries.controls?.key)
  && Array.isArray(rawBoundaries.controls?.markets) && Array.isArray(rawBoundaries.controls?.sources)
  && [...rawBoundaries.controls.markets, ...rawBoundaries.controls.sources]
    .every(id => /^[a-z][a-z0-9_]*$/.test(id)), 'checkpoint_boundary_invalid');
export const CHECKPOINT_BOUNDARIES = freeze(rawBoundaries);
export const CHECKPOINT_BOUNDARIES_SHA256 = digest(boundaryBytes);

function scope(runId, attempt) {
  requireValue(typeof runId === 'string' && typeof attempt === 'string'
    && runPattern.test(runId) && attemptPattern.test(attempt), 'checkpoint_run_invalid');
  return `${namespace}/${runId}/${attempt}`;
}

/** A capability limited to exact source reads and append-only checkpoint writes.
 * Never hand the original storage object to another module during capture. */
export function createCheckpointStorage(storage, {runId, attempt}) {
  const prefix = scope(runId, attempt);
  requireValue(storage?.driver === 'object'
    && ['readObjectMetadata', 'getBinary', 'putBinary'].every(name => typeof storage[name] === 'function'),
  'checkpoint_object_storage_required');
  const checkpointKey = key => typeof key === 'string' && (key === prefix + '/receipt.json'
    || key.startsWith(prefix + '/objects/') && /^[a-f0-9]{64}\.json$/.test(key.slice((prefix + '/objects/').length)));
  const readable = key => rootKeys.has(key) || checkpointKey(key);
  const forbidden = () => { throw new CheckpointError('checkpoint_operation_forbidden'); };
  return Object.freeze({
    driver: 'object',
    readObjectMetadata(key) {
      requireValue(readable(key), 'checkpoint_read_forbidden');
      return storage.readObjectMetadata(key);
    },
    getBinary(key) {
      requireValue(readable(key), 'checkpoint_read_forbidden');
      return storage.getBinary(key);
    },
    putBinary(key, bytes, contentType, condition) {
      requireValue(checkpointKey(key) && condition?.ifNoneMatch === '*'
        && Object.keys(condition).length === 1 && contentType === 'application/json'
        && bytes instanceof Uint8Array
        && (key === prefix + '/receipt.json' || key === `${prefix}/objects/${digest(bytes)}.json`),
      'checkpoint_write_forbidden');
      return storage.putBinary(key, bytes, contentType, {ifNoneMatch: '*'});
    },
    readJson: forbidden, readJsonWithMeta: forbidden, writeJson: forbidden,
    deleteJson: forbidden, deleteBinary: forbidden, deleteObjects: forbidden, deletePrefix: forbidden,
    listObjects: forbidden, listBucketObjects: forbidden, listObjectVersions: forbidden,
    listMultipartUploads: forbidden, abortMultipartUpload: forbidden, createBinaryDownloadUrl: forbidden,
  });
}

async function head(storage, key) {
  let result;
  try { result = await storage.readObjectMetadata(key); }
  catch { throw new CheckpointError('checkpoint_metadata_read_failed'); }
  requireValue(result && typeof result.found === 'boolean', 'checkpoint_metadata_invalid');
  if (!result.found) return {found: false, etag: null};
  requireValue(typeof result.etag === 'string' && result.etag.length > 0 && result.etag.length <= 256
    && !/[\r\n\u0000]/.test(result.etag), 'checkpoint_etag_required');
  return {found: true, etag: result.etag};
}
function sameHead(before, after) {
  return before.found === after.found && (!before.found || before.etag === after.etag);
}
async function payload(storage, key, code) {
  let value;
  try { value = await storage.getBinary(key); }
  catch { throw new CheckpointError(code); }
  requireValue(value?.data instanceof Uint8Array, code);
  const bytes = Buffer.from(value.data);
  const sha256 = digest(bytes);
  requireValue((value.size === undefined || value.size === bytes.length)
    && (value.checksum === undefined || value.checksum === sha256), code);
  return {bytes, sha256};
}
async function appendAndVerify(storage, key, bytes) {
  try { await storage.putBinary(key, bytes, 'application/json', {ifNoneMatch: '*'}); }
  catch (error) {
    // A prior interrupted attempt may have written the same content-addressed
    // object. Reuse it only after exact byte verification; never overwrite it.
    if (error?.name !== 'StorageConflictError') throw new CheckpointError('checkpoint_copy_write_failed');
  }
  const saved = await payload(storage, key, 'checkpoint_copy_readback_failed');
  requireValue(saved.bytes.length === bytes.length && saved.sha256 === digest(bytes)
    && saved.bytes.equals(bytes), 'checkpoint_copy_readback_mismatch');
  return saved.sha256;
}

function publicControls(bytes) {
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { throw new CheckpointError('checkpoint_controls_invalid'); }
  requireValue(value?.version === 1 && Number.isSafeInteger(value.revision) && value.revision >= 0
    && value.markets && typeof value.markets === 'object' && !Array.isArray(value.markets)
    && value.sources && typeof value.sources === 'object' && !Array.isArray(value.sources),
  'checkpoint_controls_invalid');
  const selected = {};
  for (const section of ['markets', 'sources']) {
    selected[section] = {};
    for (const id of CHECKPOINT_BOUNDARIES.controls[section]) {
      if (!Object.hasOwn(value[section], id)) continue;
      requireValue(typeof value[section][id]?.enabled === 'boolean', 'checkpoint_controls_invalid');
      selected[section][id] = value[section][id].enabled;
    }
  }
  // Missing newly introduced source switches remain absent: no admin defaults
  // are fabricated, and history/actor/credential-like properties are excluded.
  return {revision: value.revision, ...selected};
}
function clockDate(now) {
  const value = now();
  const time = value instanceof Date ? value.getTime() : value;
  requireValue(typeof time === 'number' && Number.isFinite(time), 'checkpoint_clock_invalid');
  return new Date(time);
}
function servingIdentity(input, startedAt) {
  requireValue(input && input.ok === true && sha.test(input.releaseSha || '')
    && checksum.test(input.calculationVersion || '')
    && typeof input.checkedAt === 'string' && Number.isFinite(Date.parse(input.checkedAt)),
  'checkpoint_serving_identity_required');
  const checkedAt = Date.parse(input.checkedAt);
  requireValue(checkedAt <= startedAt.getTime() + 60_000
    && startedAt.getTime() - checkedAt <= 10 * 60_000, 'checkpoint_serving_identity_stale');
  return {releaseSha: input.releaseSha, calculationVersion: input.calculationVersion,
    checkedAt: new Date(checkedAt).toISOString(), source: 'https://avtocena.com/api/health',
    observation: 'supplied_by_workflow_after_successful_health_check'};
}

/** Capture only the static roots. This never claims a complete backup, current
 * supplier coverage, a working catalog, or permission to delete old data.
 * storage is injected; importing this module never loads the application. */
export async function captureCheckpoint({storage, runId, attempt, sourceSha, serving, now = Date.now}) {
  const prefix = scope(runId, attempt);
  requireValue(sha.test(sourceSha || ''), 'checkpoint_source_sha_required');
  const startedAt = clockDate(now);
  const identity = servingIdentity(serving, startedAt);
  const scoped = createCheckpointStorage(storage, {runId, attempt});
  const captured = [], publicRoots = [], written = new Set();
  let controls;

  for (const root of CHECKPOINT_BOUNDARIES.roots) {
    const before = await head(scoped, root.key);
    if (!before.found) {
      requireValue(!root.required, 'checkpoint_required_root_missing');
      captured.push({...root, ...before, bytes: null, sha256: null});
      publicRoots.push({key: root.key, found: false, bytes: null, sha256: null});
      continue;
    }
    const read = await payload(scoped, root.key, 'checkpoint_source_body_invalid');
    const after = await head(scoped, root.key);
    requireValue(sameHead(before, after), 'checkpoint_root_changed');
    if (root.key === CHECKPOINT_BOUNDARIES.controls.key) controls = publicControls(read.bytes);
    const copyKey = root.mode === 'copy' ? `${prefix}/objects/${read.sha256}.json` : undefined;
    if (copyKey && !written.has(copyKey)) {
      await appendAndVerify(scoped, copyKey, read.bytes);
      written.add(copyKey);
    }
    captured.push({...root, ...before, bytes: read.bytes.length, sha256: read.sha256,
      ...(copyKey ? {copyKey} : {})});
    publicRoots.push({key: root.key, found: true, bytes: read.bytes.length, sha256: read.sha256});
  }

  // A root which was absent can appear during capture. Recheck absence too,
  // and do not create a receipt if any captured authority has changed.
  for (const root of captured) {
    requireValue(sameHead(root, await head(scoped, root.key)), 'checkpoint_root_changed');
  }
  const completedAt = clockDate(now);
  requireValue(completedAt.getTime() >= startedAt.getTime(), 'checkpoint_clock_invalid');
  const receipt = {version: 1, kind: 'catalog_rebuild_fixed_roots', complete: true,
    fullBackup: false, deletionAllowed: false, repository: CHECKPOINT_BOUNDARIES.repository,
    runId, attempt, sourceSha, inventorySourceSha: CHECKPOINT_BOUNDARIES.inventorySourceSha,
    boundariesSha256: CHECKPOINT_BOUNDARIES_SHA256, serving: identity,
    startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(),
    roots: captured, scope: 'Fixed root objects and protected fingerprints only; transitive closure is not backed up.'};
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  const receiptKey = `${prefix}/receipt.json`;
  const receiptSha256 = await appendAndVerify(scoped, receiptKey, receiptBytes);
  const report = {version: 1, kind: 'fixed_roots', complete: true,
    operationAccepted: false, servingStabilityVerified: false, fullBackup: false, deletionAllowed: false,
    rootCount: publicRoots.length, foundCount: publicRoots.filter(root => root.found).length,
    copiedObjectCount: written.size, receiptSha256, roots: publicRoots,
    ...(controls ? {controls} : {})};
  // Never return raw source content or the private receipt body.
  return {report, receiptKey, receiptSha256};
}

export function checkpointCliInput(env = process.env) {
  requireValue(env.JSON_STORAGE_DRIVER === 'object', 'checkpoint_object_storage_required');
  requireValue(env.CHECKPOINT_SERVING_HEALTH_OK === 'true', 'checkpoint_serving_identity_required');
  const input = {runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, sourceSha: env.GITHUB_SHA,
    serving: {ok: true, releaseSha: env.CHECKPOINT_SERVING_RELEASE_SHA,
      calculationVersion: env.CHECKPOINT_SERVING_CALCULATION_VERSION,
      checkedAt: env.CHECKPOINT_SERVING_CHECKED_AT}};
  scope(input.runId, input.attempt);
  requireValue(sha.test(input.sourceSha || ''), 'checkpoint_source_sha_required');
  servingIdentity(input.serving, new Date());
  return input;
}

async function main() {
  // Validate the workflow's explicit health observation before importing any
  // application module. data.ts constructs storage; no bootstrap is invoked.
  const input = checkpointCliInput();
  const {getJsonStorage} = await import('../../../apps/web/lib/data.ts');
  const {report} = await captureCheckpoint({...input, storage: getJsonStorage()});
  const output = JSON.stringify(report, null, 2) + '\n';
  if (process.env.CHECKPOINT_REPORT_PATH) {
    const target = path.resolve(process.env.CHECKPOINT_REPORT_PATH);
    await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.writeFile(target, output, {flag: 'wx'});
  }
  process.stdout.write(output);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const code = error instanceof CheckpointError ? error.code : 'checkpoint_failed';
    console.error(JSON.stringify({kind: 'fixed_roots', complete: false, operationAccepted: false,
      servingStabilityVerified: false, fullBackup: false, deletionAllowed: false, error: code}));
    process.exitCode = 1;
  });
}
