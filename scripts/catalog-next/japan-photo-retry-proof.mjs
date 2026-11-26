import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CRM_JAPAN_PHOTO_CODE_SCOPE} from './crm-japan-photo-code-scope.mjs';

export const JAPAN_PHOTO_RETRY_FIXTURE_MAX_BYTES = 16 * 1024;
export const JAPAN_PHOTO_RETRY_PROOF_MAX_BYTES = 32 * 1024;
const need = (value, code) => { if (!value) throw Error('japan_photo_retry_proof_' + code); };
const sha = raw => createHash('sha256').update(raw).digest('hex');
const SHA = /^[a-f0-9]{64}$/, RUNTIME = /^[a-f0-9]{40}$/, NONCE = /^[a-f0-9]{32}$/;
const FIXTURE_KEYS = ['version', 'kind', 'passed', 'widths', 'caseCount', 'checks'];
const CHECKS = ['transientRecovery', 'persistentFailureBound', 'sourceChangeCancellation', 'unmountCancellation',
  'exactUrl', 'noExternalRequests', 'protectedPhotoPreserved', 'lazyLoadRecovery'];
const EVIDENCE_KEYS = ['version', 'kind', 'codeScope', 'release', 'nonce', 'checkedAt', 'oracleSha256',
  'fixtureBase64', 'fixtureSha256', 'passed', 'directSupplierRequests', 'productionMutations'];

// Snapshot only own data properties. Accessors, symbols and extra fields must
// never be invoked or echoed into a public or host-bound report.
function ownData(value, keys, code, array = false) {
  try {
    need(value !== null && typeof value === 'object' && Array.isArray(value) === array, code);
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    need(names.length === keys.length && names.every(name => typeof name === 'string' && keys.includes(name)), code);
    const copy = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      need(descriptor && Object.hasOwn(descriptor, 'value'), code);
      copy[key] = descriptor.value;
    }
    return copy;
  } catch { throw Error('japan_photo_retry_proof_' + code); }
}

export function checkedJapanPhotoRetryBrowserFixture(report) {
  const value = ownData(report, FIXTURE_KEYS, 'fixture');
  need(value.version === 1 && value.kind === 'japan-photo-retry-browser-v1' && value.passed === true
    && value.caseCount === 12, 'fixture');
  const widths = ownData(value.widths, ['0', '1', 'length'], 'fixture_widths', true);
  need(widths.length === 2 && widths[0] === 1440 && widths[1] === 390, 'fixture_widths');
  const checks = ownData(value.checks, CHECKS, 'fixture_checks');
  need(CHECKS.every(key => checks[key] === true), 'fixture_checks');
  return Object.freeze({version: 1, kind: value.kind, passed: true, widths: Object.freeze([1440, 390]),
    caseCount: 12, checks: Object.freeze(checks)});
}

function checkedFixtureBytes(raw) {
  need(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= JAPAN_PHOTO_RETRY_FIXTURE_MAX_BYTES, 'fixture_size');
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw)); }
  catch { throw Error('japan_photo_retry_proof_fixture_json'); }
  return checkedJapanPhotoRetryBrowserFixture(parsed);
}

const regular = value => value.isFile() && !value.isSymbolicLink() && value.nlink === 1n
  && value.size > 0n && value.size <= BigInt(JAPAN_PHOTO_RETRY_FIXTURE_MAX_BYTES);
const identity = value => [value.dev, value.ino, value.nlink, value.size, value.mtimeNs, value.ctimeNs];
const unchanged = (left, right) => identity(left).every((value, index) => value === identity(right)[index]);

/** One local artifact, bounded by its original size and a fixed read buffer.
 * It is not accepted through a symlink, hard link, replaced path or changed fd. */
export async function readJapanPhotoRetryFixture(filename) {
  let handle;
  try {
    need(typeof filename === 'string' && path.isAbsolute(filename) && path.resolve(filename) === filename, 'fixture_path');
    need(await fs.realpath(filename) === filename, 'fixture_path');
    const before = await fs.lstat(filename, {bigint: true});
    need(regular(before), 'fixture_file');
    handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({bigint: true});
    need(regular(opened) && unchanged(before, opened), 'fixture_changed');
    const buffer = Buffer.alloc(JAPAN_PHOTO_RETRY_FIXTURE_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const {bytesRead} = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    need(length === Number(before.size) && length <= JAPAN_PHOTO_RETRY_FIXTURE_MAX_BYTES, 'fixture_changed');
    const after = await handle.stat({bigint: true}), current = await fs.lstat(filename, {bigint: true});
    need(regular(after) && regular(current) && unchanged(before, after) && unchanged(before, current)
      && await fs.realpath(filename) === filename, 'fixture_changed');
    const raw = Buffer.from(buffer.subarray(0, length));
    checkedFixtureBytes(raw);
    return raw;
  } catch (error) {
    if (/^japan_photo_retry_proof_[a-z_]+$/.test(error?.message ?? '')) throw error;
    throw Error('japan_photo_retry_proof_fixture_read');
  } finally { if (handle) await handle.close(); }
}

export function checkedJapanPhotoRetryEvidence(report, {candidate, nonce, oracleSha256, codeScope,
  startedAt, now = Date.now()} = {}) {
  const value = ownData(report, EVIDENCE_KEYS, 'evidence');
  const expectedRelease = Object.getOwnPropertyDescriptor(candidate ?? {}, 'runtimeSha')?.value;
  need(codeScope === CRM_JAPAN_PHOTO_CODE_SCOPE && RUNTIME.test(expectedRelease ?? '')
    && NONCE.test(nonce ?? '') && SHA.test(oracleSha256 ?? '')
    && Number.isSafeInteger(startedAt) && startedAt >= 0 && Number.isSafeInteger(now) && now >= startedAt, 'binding');
  need(value.version === 1 && value.kind === 'japan-photo-retry-proof-v1' && value.codeScope === codeScope
    && value.release === expectedRelease && value.nonce === nonce && value.oracleSha256 === oracleSha256
    && value.passed === true && value.directSupplierRequests === 0 && value.productionMutations === 0, 'evidence');
  const checkedAt = typeof value.checkedAt === 'string' ? Date.parse(value.checkedAt) : NaN;
  need(Number.isFinite(checkedAt) && new Date(checkedAt).toISOString() === value.checkedAt
    && checkedAt >= startedAt && checkedAt <= now, 'checked_at');
  need(typeof value.fixtureBase64 === 'string' && value.fixtureBase64.length > 0
    && value.fixtureBase64.length <= Math.ceil(JAPAN_PHOTO_RETRY_FIXTURE_MAX_BYTES / 3) * 4
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.fixtureBase64)
    && typeof value.fixtureSha256 === 'string' && SHA.test(value.fixtureSha256), 'fixture_encoding');
  const raw = Buffer.from(value.fixtureBase64, 'base64');
  need(raw.toString('base64') === value.fixtureBase64 && sha(raw) === value.fixtureSha256, 'fixture_hash');
  checkedFixtureBytes(raw);
  need(Buffer.byteLength(JSON.stringify(value)) <= JAPAN_PHOTO_RETRY_PROOF_MAX_BYTES, 'evidence_size');
  return Object.freeze(value);
}
